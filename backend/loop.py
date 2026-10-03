import numpy as np
import json
import os
from backend.simulator import simulate_transmission_spectrum, evaluate_fit
from backend.agents import ask_insight_agent, ask_analysis_agent

def run_discovery_loop(target_file="data/target_spectrum.csv", max_iterations=3):
    """
    Runs the autonomous Omnigent discovery loop:
    1. Loads target data from CSV.
    2. Insight Agent suggests parameters based on RMSE error.
    3. Simulator computes transmission spectrum and evaluates RMSE.
    4. Feedback loop controls the next iteration.
    """
    print("🚀 Starting the autonomous exoplanet discovery loop...")
    
    # 1. Load target observation data
    if not os.path.exists(target_file):
        print(f"❌ Error: {target_file} not found. Please run simulator.py first!")
        return
        
    data = np.loadtxt(target_file, delimiter=",", skiprows=1)
    wavelengths = data[:, 0]
    target_spectrum = data[:, 1]
    
    # Initial parameters (initial guess for the agent team)
    current_h2o = 1.0
    current_haze = 1.0
    
    history = "Experiment started with baseline default values (H2O=1.0, Haze=1.0).\n"
    best_fits = []
    
    for iteration in range(1, max_iterations + 1):
        print(f"\n--- Iteration {iteration} of {max_iterations} ---")
        
        # Simulate transmission spectrum with current parameters
        simulated_spectrum = simulate_transmission_spectrum(wavelengths, h2o_abund=current_h2o, haze_factor=current_haze)
        current_rmse = evaluate_fit(simulated_spectrum, target_spectrum)
        
        print(f"🧪 Tested Parameters -> H2O: {current_h2o:.3f}, Haze: {current_haze:.3f} | RMSE (Loss): {current_rmse:.6f}")
        
        best_fits.append({
            "iteration": iteration,
            "h2o": current_h2o,
            "haze": current_haze,
            "rmse": current_rmse
        })
        
        # Early stopping if convergence is excellent
        if current_rmse < 0.00018:
            print("✨ Convergence reached! Excellent fit found.")
            break
            
        # 2. Ask the Insight Agent for next parameters
        print("🤖 Insight Agent analyzing error residuals and planning next step...")
        agent_response = ask_insight_agent(current_h2o, current_haze, current_rmse, history)
        print(f"Insight Agent Response:\n{agent_response}")
        
        # Parse values from agent response
        try:
            for line in agent_response.split('\n'):
                if "H2O" in line and "HAZE" in line:
                    parts = line.replace(' ', '').split(',')
                    for p in parts:
                        if p.startswith('H2O:'):
                            current_h2o = float(p.split(':')[1])
                        elif p.startswith('HAZE:'):
                            current_haze = float(p.split(':')[1])
            history += f"Iteration {iteration}: H2O={current_h2o}, Haze={current_haze}, RMSE={current_rmse}\n"
        except Exception as e:
            print(f"⚠️ Could not parse agent response automatically ({e}), adjusting parameters adaptively...")
            current_h2o += 0.1
            current_haze += 0.1

    # 3. Final analysis by the Analysis Agent (Degeneracy check & report)
    print("\n🔬 Starting final analysis by the Analysis Agent (Checking for parameter degeneracy)...")
    target_summary = f"Target observation spectrum with {len(wavelengths)} data points and realistic instrument noise."
    analysis_report = ask_analysis_agent(target_summary, json.dumps(best_fits, indent=2))
    
    print("\n=== FINAL ANALYSIS REPORT (DEGENERACY & RECOMMENDATIONS) ===")
    print(analysis_report)
    
    return best_fits, analysis_report

if __name__ == "__main__":
    run_discovery_loop()