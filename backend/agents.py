import os
import sys
import anthropic
from dotenv import load_dotenv

# Load environment variables from the .env file in the root directory
load_dotenv()

# Windows consoles default to cp1252, which can't print the emoji below
sys.stdout.reconfigure(encoding="utf-8")

api_key = os.getenv("ANTHROPIC_API_KEY")
if not api_key:
    print("❌ FEHLER: ANTHROPIC_API_KEY wurde nicht gefunden! Überprüfe deine .env-Datei im Hauptverzeichnis.")
else:
    print(f"✅ API-Key erfolgreich geladen.")

client = anthropic.Anthropic(api_key=api_key)

def _extract_text(message):
    """Join all text blocks; the response may also contain thinking blocks."""
    return "".join(block.text for block in message.content if block.type == "text").strip()

def ask_insight_agent(current_h2o, current_haze, current_rmse, history=""):
    """
    The Insight Agent analyzes the current error (RMSE) and proposes 
    the next parameters (H2O abundance and haze factor).
    """
    prompt = f"""
You are an AI scientist in an autonomous exoplanet research laboratory.
Your goal is to find the true atmospheric parameters (H2O abundance and haze factor) of an exoplanet through iterative testing.

Previous attempts & history:
{history}

Current state:
- H2O abundance: {current_h2o}
- Haze factor: {current_haze}
- Current RMSE (Error): {current_rmse}

Your task:
Propose new, more precise parameters for the next simulation step to further minimize the error.
Respond EXCLUSIVELY in the following format (without any additional text):
H2O: <new_value>, HAZE: <new_value>, REASON: <short_reason>
"""

    message = client.messages.create(
        model="claude-opus-5-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return _extract_text(message)

def ask_analysis_agent(target_summary, best_fits_history):
    """
    The Analysis Agent checks the final result for parameter degeneracy
    and provides a scientific recommendation for future observations.
    """
    prompt = f"""
You are the lead analysis agent in our exoplanet laboratory.
We have completed an optimization loop. Here are the best fits and parameters found:
{best_fits_history}

Target dataset summary:
{target_summary}

Your task:
1. Check whether parameter degeneracy is present (i.e., whether different physical parameters produce mathematically nearly identical fits).
2. Create a short, concise scientific report.
3. Provide a concrete recommendation on which wavelength should be measured in future telescope observations (e.g., JWST) to break the degeneracy.

Format your response clearly in Markdown.
"""

    message = client.messages.create(
        model="claude-opus-5-5",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return _extract_text(message)

if __name__ == "__main__":
    print("Testing connection to the Anthropic API...")
    try:
        response = ask_insight_agent(
            current_h2o=1.0, 
            current_haze=1.0, 
            current_rmse=0.005, 
            history="Experiment started."
        )
        print("\n✅ Connection successful! Response from Insight Agent:")
        print(response)
    except Exception as e:
        print(f"\n❌ API connection error: {e}")