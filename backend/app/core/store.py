import os
import json
from pathlib import Path
from typing import Dict, List, Any

# Locate root directories
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BACKEND_DIR / "data"
SEED_DIR = BACKEND_DIR

class Store:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.agents_path = DATA_DIR / "agents.json"
        self.plugins_path = DATA_DIR / "plugins.json"
        self.settings_path = DATA_DIR / "settings.json"
        self._init_files()

    def _init_files(self):
        # Seed agents
        if not self.agents_path.exists():
            seed_agents = SEED_DIR / "seed_agents.json"
            if seed_agents.exists():
                with open(seed_agents, "r", encoding="utf-8") as f:
                    agents = json.load(f)
            else:
                agents = []
            self.save_agents(agents)

        # Seed plugins
        if not self.plugins_path.exists():
            seed_plugins = SEED_DIR / "seed_plugins.json"
            if seed_plugins.exists():
                with open(seed_plugins, "r", encoding="utf-8") as f:
                    plugins = json.load(f)
            else:
                plugins = []
            self.save_plugins(plugins)

        # Seed settings
        if not self.settings_path.exists():
            default_settings = {
                "orchestrator": {
                    "model": "qwen3:4b",
                    "temperature": 0.3,
                    "top_p": 0.9,
                    "top_k": 40
                }
            }
            self.save_settings(default_settings)

    def load_agents(self) -> List[Dict[str, Any]]:
        with open(self.agents_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_agents(self, agents: List[Dict[str, Any]]):
        with open(self.agents_path, "w", encoding="utf-8") as f:
            json.dump(agents, f, indent=2, ensure_ascii=False)

    def load_plugins(self) -> List[Dict[str, Any]]:
        with open(self.plugins_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_plugins(self, plugins: List[Dict[str, Any]]):
        with open(self.plugins_path, "w", encoding="utf-8") as f:
            json.dump(plugins, f, indent=2, ensure_ascii=False)

    def load_settings(self) -> Dict[str, Any]:
        with open(self.settings_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_settings(self, settings: Dict[str, Any]):
        with open(self.settings_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)

# Singleton store instance
store = Store()
