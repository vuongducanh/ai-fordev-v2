import base64
import logging
from typing import List, Dict, Any

from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.agent_execution.context import RequestContext
from a2a.server.events.event_queue import EventQueue
import a2a.types.a2a_pb2 as pb

from app.core import llm, toolevents
from app.core.store import store
from app.agents.tools import run_with_tools

logger = logging.getLogger(__name__)

class AgentLLMExecutor(AgentExecutor):
    def __init__(self, agent_id: str):
        self.agent_id = agent_id

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Runs the LLM execution process for the agent."""
        try:
            # 1. Read config dynamically from store
            agents = store.load_agents()
            agent = next((a for a in agents if a["id"] == self.agent_id), None)
            if not agent:
                raise ValueError(f"Agent '{self.agent_id}' not found in configuration store")

            # Set task-local context variables for tool event tracking
            toolevents.set_agent(self.agent_id)

            # 2. Extract texts and image data URIs (if vision enabled)
            texts = []
            images = []
            if context.message and context.message.parts:
                for part in context.message.parts:
                    if part.text:
                        texts.append(part.text)
                    elif part.inline_data and part.inline_data.data:
                        # Extract image base64 if agent supports vision
                        if agent.get("llm", {}).get("vision", False):
                            mime = part.inline_data.mime_type or "image/jpeg"
                            b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                            images.append(f"data:{mime};base64,{b64}")
                            
            prompt_text = "\n".join(texts) if texts else context.get_user_input()

            # 3. Build messages list (system instruction + user prompt)
            messages = []
            sys_prompt = agent.get("llm", {}).get("system_prompt", "")
            if sys_prompt:
                messages.append(llm.system_message(sys_prompt))
            
            user_content = llm.build_user_content(prompt_text, images)
            messages.append({"role": "user", "content": user_content})

            # 4. Run execution.
            #    The orchestrator calls this agent via non-streaming SendMessage and
            #    reads result["parts"], so we respond in a2a "message mode": accumulate
            #    the full reply and enqueue a single Message (no Task / status events,
            #    which would put us in task mode and be rejected).
            plugins = agent.get("plugins", [])
            reply_text = ""

            if plugins:
                # Agent has plugins: run non-streaming with tools RAG loop
                reply_text = await run_with_tools(agent, messages)
            else:
                # Agent has no plugins: stream text and accumulate the full reply
                text_accum = []
                async for delta in llm.stream_text(agent["llm"], messages):
                    text_accum.append(delta)
                reply_text = "".join(text_accum)

            # 5. Emit the final reply as a single Message (message mode)
            final_message = pb.Message(
                task_id=context.task_id,
                context_id=context.context_id,
                parts=[pb.Part(text=reply_text)]
            )
            await event_queue.enqueue_event(final_message)

        except Exception as e:
            logger.exception("AgentLLMExecutor execution failed: %s", e)
            # Re-raise so the caller receives a JSON-RPC error and can fall back.
            raise e

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Cancel implementation (no-op as executions are synchronous model queries)."""
        pass
