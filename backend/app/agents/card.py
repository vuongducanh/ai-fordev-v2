from a2a.types import AgentCard
from google.protobuf.json_format import ParseDict

def build_card(agent_dict: dict, port: int) -> AgentCard:
    """Builds a protobuf AgentCard from JSON store agent configuration."""
    card_data = agent_dict["card"].copy()
    agent_id = agent_dict["id"]
    
    # Declare the communication interface endpoints
    card_data["supported_interfaces"] = [
        {
            "url": f"http://localhost:{port}/agents/{agent_id}",
            "protocol_binding": "JSONRPC",
            "protocol_version": "1.0"
        }
    ]
    
    card = AgentCard()
    ParseDict(card_data, card)
    return card
