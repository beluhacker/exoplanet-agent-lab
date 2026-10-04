import numpy as np
import os

def simulate_transmission_spectrum(wavelengths, h2o_abund=1.0, haze_factor=1.0, baseline_depth=0.015):
    """
    Simulates a simplified exoplanet transmission spectrum.

    Parameters:
    - wavelengths: Array of wavelengths in micrometers (um)
    - h2o_abund: Scaling factor for water abundance
    - haze_factor: Strength of the aerosol/haze layer
    - baseline_depth: Grey transit depth (Rp/R*)^2, default 1.5%
    """
    atm_scale = 0.0008
    
    # H2O absorption bands around ~1.4 um and ~1.9 um
    absorption_h2o = h2o_abund * (
        0.4 * np.exp(-((wavelengths - 1.4) / 0.12)**2) +
        0.6 * np.exp(-((wavelengths - 1.9) / 0.18)**2)
    )
    
    # Aerosol/haze scattering (blue-end scattering)
    haze_scattering = haze_factor * (0.003 / wavelengths)
    
    transit_depth = baseline_depth + atm_scale * (absorption_h2o + haze_scattering)
    return transit_depth

def generate_target_observation():
    """
    Generates a synthetic target dataset (the "telescope observation")
    with injected noise and a hidden parameter degeneracy, saving it as a CSV.
    """
    # Wavelength grid from 0.6 to 4.5 µm (300 data points)
    wavelengths = np.linspace(0.6, 4.5, 300)
    
    # "True" hidden parameters of the exoplanet atmosphere
    true_h2o = 1.4
    true_haze = 0.9
    
    # Calculate clean spectrum
    clean_spectrum = simulate_transmission_spectrum(wavelengths, h2o_abund=true_h2o, haze_factor=true_haze)
    
    # Add realistic instrumental Gaussian noise
    np.random.seed(42)  # Fixed seed for reproducible demo results
    noise_level = 0.00015
    noise = np.random.normal(0, noise_level, size=len(wavelengths))
    noisy_observation = clean_spectrum + noise
    
    # Ensure the data directory exists
    os.makedirs("data", exist_ok=True)
    
    # Save as CSV file in the data/ folder
    file_path = "data/target_spectrum.csv"
    data_stack = np.column_stack((wavelengths, noisy_observation))
    np.savetxt(file_path, data_stack, delimiter=",", header="wavelength_um,transit_depth", comments="")
    
    print(f"✅ Target dataset successfully saved to '{file_path}'!")
    print(f"Data points in spectrum: {len(wavelengths)}")
    print(f"First 5 noisy transit depths: {noisy_observation[:5]}")
    
    return wavelengths, noisy_observation

def evaluate_fit(simulated_spectrum, target_spectrum):
    """
    Calculates the Root Mean Square Error (RMSE) between 
    the simulated curve and the noisy target data.
    """
    rmse = np.sqrt(np.mean((simulated_spectrum - target_spectrum) ** 2))
    return rmse

if __name__ == "__main__":
    generate_target_observation()