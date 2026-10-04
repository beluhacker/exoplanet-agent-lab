# Asterion Lab

**Autonomous exoplanet atmosphere discovery from transmission spectra**

Asterion Lab is a full-stack research application that coordinates three AI-assisted scientific roles around a deterministic exoplanet transmission-spectrum model. A user starts one discovery run from the browser. The application then searches current literature, proposes atmospheric hypotheses, tests those hypotheses against an observed spectrum, derives physical and statistical metrics, and presents a final report.

This repository contains the complete application: the React dashboard, the server functions, the AI and arXiv integrations, the scientific forward model, the bundled observations, and the tests.

> **Scientific scope:** Asterion Lab is an educational and exploratory research tool. Its forward model is intentionally simplified. Its outputs are not a substitute for a validated atmospheric-retrieval pipeline, instrument-specific reduction, peer review, or independent scientific verification.

## Table of contents

- [What the program does](#what-the-program-does)
- [How to use the program](#how-to-use-the-program)
- [How to interpret the results](#how-to-interpret-the-results)
- [System architecture](#system-architecture)
- [Backend and discovery workflow](#backend-and-discovery-workflow)
- [Scientific model](#scientific-model)
- [Data format and bundled datasets](#data-format-and-bundled-datasets)
- [Installation and local development](#installation-and-local-development)
- [Configuration](#configuration)
- [Commands](#commands)
- [Project structure](#project-structure)
- [Server-function reference](#server-function-reference)
- [Changing the program](#changing-the-program)
- [Testing and validation](#testing-and-validation)
- [Troubleshooting](#troubleshooting)
- [Security and operational notes](#security-and-operational-notes)
- [Known limitations](#known-limitations)
- [Provenance and license](#provenance-and-license)

---

## What the program does

Asterion Lab analyzes an observed transmission spectrum in a fixed three-iteration discovery loop:

1. The **Literature Agent** summarizes the observation and asks the language model for relevant exoplanet search queries.
2. The backend searches the public arXiv API and collects matching paper metadata and abstracts.
3. The Literature Agent turns those sources into a concise scientific prior.
4. The **Experiment Agent** proposes a six-parameter atmospheric hypothesis.
5. A deterministic TypeScript forward model generates the corresponding spectrum and scores it against the observation.
6. The **Analysis Agent** calculates planet and atmosphere metrics and writes a short verdict.
7. The browser displays the new fit, results, metrics, and activity before starting the next iteration.
8. After three iterations, the orchestrator selects the experiment with the lowest reduced chi-square and creates the final report.

The agents do not invent the numerical fit. Language models propose parameters and explain results; deterministic code calculates the modeled spectrum and all reported statistics.

### Main capabilities

- Loads and visualizes a bundled exoplanet transmission spectrum.
- Searches live arXiv literature without requiring an arXiv API key.
- Uses an AI model to propose literature queries, synthesize findings, select model parameters, and explain results.
- Models H2O, CO2, and CH4 absorption, wavelength-dependent haze, and baseline transit depth.
- Rejects isolated spectral outliers before fitting.
- Calculates RMSE, chi-square, reduced chi-square, degrees of freedom, a fit p-value, and residuals in ten wavelength bands.
- Estimates transit significance, atmosphere significance, molecule evidence, and planet radius.
- Shows each iteration in a live laboratory-style dashboard.
- Keeps every discovery step stateless and compatible with serverless deployment.

---

## How to use the program

### 1. Open the application

Start the local development server or open the deployed application. The dashboard loads the default observation automatically.

At startup, the page shows:

- the target file name;
- the number of retained data points;
- wavelength coverage in micrometers;
- median transit depth in parts per million;
- estimated per-point noise;
- the observed transmission spectrum;
- all agents in the **Waiting** state;
- empty experiment, analysis, and report sections.

No discovery run starts automatically.

### 2. Start a discovery run

Select **Run Discovery Loop**.

The button changes to **Discovery running** and remains disabled until the run ends. A unique in-browser run ID is created in the form `run_<timestamp>`. The current implementation always performs three iterations.

A complete run makes several external requests and can take a few minutes. Keep the page open while it runs. The current run is browser-driven; reloading or leaving the page interrupts the visible workflow.

### 3. Follow agent activity

Use two areas to monitor progress:

- **Agent Activity** shows whether the Orchestrator, Literature, Experiment, or Analysis role is working and displays its latest activity.
- **Agent Log Stream** shows timestamped lifecycle events, arXiv searches, experiment calls, results, completion messages, and failures.

Entries marked with `[+]` can be expanded to inspect the full tool-call detail.

During each iteration, the workflow is:

```text
Literature search → literature brief → hypothesis proposal
→ deterministic experiment → numerical metrics → analysis verdict
```

A failed individual arXiv query is recorded in the log and does not necessarily stop the run. A failure in a required model or experiment step moves the overall status to **Failed**.

### 4. Inspect each experiment

After the Experiment Agent finishes an iteration, a row appears in **Experiments**. It contains:

- the iteration and experiment ID;
- H2O, CO2, and CH4 abundance coefficients;
- haze strength and slope;
- baseline transit depth in ppm;
- reduced chi-square;
- RMSE in ppm.

The best experiment so far is highlighted. “Best” means the smallest reduced chi-square among the hypotheses that the agents actually tested. It does not prove that the model is physically unique or globally optimal.

### 5. Compare the model and observation

After the first experiment, the **Transmission Spectrum** chart overlays the current best model on the observation.

- **Observed** is the measured transit depth.
- **Best model** is the prediction from the lowest-reduced-chi-square experiment.
- Vertical labels mark the modeled H2O, CH4, and CO2 band centers.
- Moving over the chart reveals wavelength and transit depth in ppm.
- **Mean |residual|** summarizes the absolute difference between observation and displayed fit.

### 6. Read the analysis

After every experiment, the **Analysis** panel receives a new verdict. The experiment ranking is sorted from lowest to highest reduced chi-square.

The **Planet Metrics** panel displays metrics for the current best experiment when available:

- transit signal-to-noise;
- atmosphere detection significance;
- planet-to-star radius ratio;
- radius in Earth and Jupiter radii;
- assumed stellar radius;
- fit p-value;
- H2O, CO2, and CH4 evidence.

### 7. Read the final report

When all three iterations finish, the status changes to **Complete**. The final report contains:

- the selected experiment;
- reduced chi-square, RMSE, and degrees of freedom;
- all six model parameters;
- transit and atmosphere significance;
- molecule evidence;
- radius estimates;
- fit p-value;
- excluded outlier wavelengths, if any;
- the Analysis Agent’s verdict.

The report is generated in browser memory and displayed in the dashboard. It is not written to a database or file by the backend.

### 8. Start a new run

Select **Run Discovery Loop** again after completion. The dashboard clears the previous run and starts a new one. Because the language model can propose different hypotheses, different runs may explore different parameter combinations, even though fitting a given hypothesis is deterministic.

---

## How to interpret the results

### Model parameters

| Parameter | Allowed range | Meaning |
| --- | ---: | --- |
| `h2o_abundance` | 0–3 | Relative amplitude of the modeled H2O absorption bands |
| `co2_abundance` | 0–3 | Relative amplitude of the modeled CO2 band |
| `ch4_abundance` | 0–3 | Relative amplitude of the modeled CH4 band |
| `haze_factor` | 0–3 | Strength of short-wavelength haze scattering |
| `haze_slope` | 0–4 | Wavelength exponent; 1 is relatively grey and 4 is Rayleigh-like |
| `baseline_depth` | 0.005–0.05 | Featureless transit-depth baseline, expressed as a fraction |

These “abundances” are dimensionless amplitudes in this simplified model. They are not directly retrieved chemical volume-mixing ratios.

### Fit statistics

- **Residual:** observed depth minus modeled depth. A positive residual means the observed transit is deeper than the model.
- **RMSE:** root-mean-square residual. Smaller values indicate a closer average match. The interface converts it from fractional depth to ppm.
- **Chi-square (`chi2`):** sum of squared residuals normalized by the estimated noise.
- **Degrees of freedom (`dof`):** number of retained observation points minus six model parameters.
- **Reduced chi-square (`chi2 / dof`):** approximately 1 can indicate consistency with the assumed noise model; values much larger than 1 indicate remaining mismatch or underestimated noise; values much smaller than 1 can indicate overestimated noise or overfitting.
- **Fit p-value:** upper-tail probability from the chi-square distribution. A very small value means that the residuals are unlikely under this model and noise estimate.
- **Band residual:** mean residual within one wavelength interval. It is also reported in units of the standard error of that band’s mean.

These statistics depend on the application’s model-independent white-noise estimate. They do not include a covariance model or instrument systematics.

### Detection and physical metrics

- **Transit S/N:** mean transit depth divided by the standard error of the mean.
- **Atmosphere significance:** square root of the improvement in chi-square over a flat spectrum, clipped at zero.
- **Molecule significance:** square root of the increase in chi-square when one molecule is removed from the selected model, clipped at zero.
- **Feature amplitude:** maximum minus minimum modeled transit depth.
- **Feature S/N per point:** feature amplitude divided by estimated per-point noise.
- **`Rp / R*`:** square root of the baseline transit depth.
- **Planet radius:** `Rp / R*` multiplied by the assumed stellar radius. The dashboard currently uses `1.0 R_sun` because the bundled observations do not contain stellar parameters.

The atmosphere and molecule significances are convenient likelihood-style diagnostics, not full Bayesian detection claims. Parameter covariance and a formal look-elsewhere correction are not included.

---

## System architecture

```text
Browser
┌─────────────────────────────────────────────────────────────────┐
│ React dashboard                                                  │
│ src/routes/index.tsx                                             │
│                                                                  │
│ TanStack Query loads the observation                             │
│ useServerFn starts each literature / experiment / analysis step  │
│ Browser holds the current run, iteration history, log, report    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ typed TanStack Start RPC
                               ▼
Server-function boundary
┌─────────────────────────────────────────────────────────────────┐
│ src/lib/discovery.functions.ts                                   │
│ Zod validation and plain serializable request/response objects   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ server-only calls
                               ▼
Backend services
┌────────────────────────────────┐  ┌──────────────────────────────┐
│ src/server/agents.server.ts     │  │ src/server/spectrum.server.ts│
│                                │  │                              │
│ Lovable AI Gateway             │  │ CSV parsing                  │
│ arXiv API                      │  │ outlier rejection            │
│ literature synthesis           │  │ forward model                │
│ hypothesis proposal            │  │ fit statistics               │
│ analysis verdict               │  │ derived planet metrics       │
└────────────────────────────────┘  └──────────────────────────────┘
```

### Runtime boundaries

The route file imports only client-safe server-function wrappers and shared types. Server-only code lives under `src/server/` and is never included in the browser bundle.

The server functions return plain serializable objects. There are no raw HTTP API routes in the current application and no public REST API. TanStack Start transports calls through its internal typed RPC mechanism; callers should not manually request internal server-function URLs.

### Stateless execution

The backend does not keep an active run in process memory, on disk, or in a database. The browser passes summaries of previous experiments into the next literature and experiment calls.

This design is intentional:

- it works in a serverless runtime where requests may execute on different instances;
- a deterministic experiment can be repeated from its inputs;
- no Python process or long-running worker is needed;
- there is no account, session, or persistence layer to configure.

The trade-off is that refreshing the browser loses the current run and completed reports.

---

## Backend and discovery workflow

### Observation loading

The route loader calls `getObservation` through TanStack Query before rendering the dashboard. The server reads one of the CSV files bundled into the application at build time, parses it, calculates summary values, and returns chart points in ppm.

The runtime does not read arbitrary filesystem paths. Only file names listed in `TARGET_FILES` are accepted.

### Literature step

`runLiteratureStep` accepts the target identifier and summaries of previous experiments.

The server then:

1. describes the observation, including coverage, depth range, noise, band means, and rejected points;
2. asks `google/gemini-3.7-flash` for two to four relevant search queries;
3. searches `https://export.arxiv.org/api/query` in category `astro-ph.EP`;
4. parses titles, abstracts, URLs, and publication dates from the Atom XML response;
5. reads up to 12 returned abstracts in the synthesis prompt;
6. returns a plain-text scientific prior, paper metadata, and activity events.

Each arXiv request has a 20-second timeout. If one query fails, the event is recorded and the remaining queries continue. If query generation or synthesis fails, the step returns an empty prior plus failure events instead of throwing; the run can continue with less context.

### Experiment step

`runExperimentStep` receives the run ID, experiment ID, target, literature prior, and previous experiment summaries. An explicit hypothesis may also be supplied by code.

Without an explicit hypothesis, the Experiment Agent proposes one. Its response is parsed as JSON and every parameter is clamped to the permitted range. The backend then runs the deterministic forward model, calculates the residuals and fit statistics, and returns:

- the normalized hypothesis;
- an experiment summary;
- observed and modeled chart points;
- lifecycle events.

The prompt tells the model to use previous band residuals and change no more than two parameters relative to the best prior experiment. This is an instruction to the model, not a separately enforced mathematical constraint.

### Analysis step

`runAnalysisStep` receives one completed hypothesis and an optional stellar radius. The backend repeats the deterministic experiment, calculates all planet metrics, and asks the Analysis Agent for a verdict of at most six sentences.

The verdict addresses:

- whether atmosphere evidence is significant;
- which molecules are supported;
- whether the radius estimate is plausible;
- whether another iteration is needed and which parameter may be responsible for remaining mismatch.

Unlike the literature step, an AI failure in the analysis step throws and the dashboard marks the run as failed.

### Orchestration in the browser

The current orchestrator is the `runDiscovery` function in `src/routes/index.tsx`. It runs each step sequentially for `MAX_ITERATIONS = 3`, updates the interface after each response, selects the experiment with the smallest reduced chi-square, and builds the report.

This means the backend supplies complete scientific steps, while the browser controls the sequence. There is no queue or background job. Closing the page does not leave a server-side run continuing in the background.

### AI response handling

Model calls use:

- model: `google/gemini-3.7-flash`;
- temperature: `0.4`;
- timeout: 90 seconds;
- task-specific output-token limits.

JSON-producing prompts use a defensive parser. It removes Markdown code fences, searches for a JSON object, and attempts to close a response truncated near the token limit. Returned parameters are still normalized and validated before use.

---

## Scientific model

### Forward model equation

For wavelength `lambda`, the modeled transit depth is conceptually:

```text
D(lambda) = baseline_depth
          + 0.0008 × [
                h2o_abundance × H2O(lambda)
              + co2_abundance × CO2(lambda)
              + ch4_abundance × CH4(lambda)
              + haze_factor × 0.003 × lambda^(-haze_slope)
            ]
```

Molecular profiles are Gaussian bands:

| Species | Center(s), µm | Width(s) | Relative amplitude |
| --- | --- | --- | --- |
| H2O | 1.4, 1.9, 2.7 | 0.12, 0.18, 0.15 | 0.4, 0.6, 0.8 |
| CH4 | 3.3 | 0.12 | 0.7 |
| CO2 | 4.3 | 0.12 | 1.0 |

A band uses `exp(-((lambda - center) / width)^2)`. The implementation intentionally matches the original Python project; the `width` value is therefore not a conventional Gaussian standard deviation.

### Noise estimation

The program estimates a single white-noise scale from adjacent transit-depth differences:

```text
sigma = sample_std(diff(transit_depth)) / sqrt(2)
```

This avoids requiring an uncertainty column in the input data. The same `sigma` is used for all retained points.

### Outlier removal

Before calculating summaries or fits, the program:

1. applies a five-point median filter with replicated edge values;
2. estimates robust scatter from the median absolute adjacent difference;
3. excludes individual points more than five robust sigma from the local median.

Broad spectral features span multiple points and should survive this filter. Removed points are listed in the experiment summary and final report.

### Residual bands

Residuals are grouped into ten intervals:

| Name | Range, µm |
| --- | ---: |
| Optical haze | 0.0–1.2 |
| H2O 1.4 band | 1.2–1.6 |
| H2O 1.9 band | 1.6–2.2 |
| Continuum | 2.2–2.5 |
| H2O 2.7 band | 2.5–2.9 |
| Continuum | 2.9–3.1 |
| CH4 3.3 band | 3.1–3.5 |
| Continuum | 3.5–4.1 |
| CO2 4.3 band | 4.1–4.5 |
| Long-wavelength continuum | 4.5–99.0 |

For each non-empty interval, the backend returns the mean residual, the mean residual in standard-error units, and the number of points.

### Statistical implementation

The project has no Python, NumPy, or SciPy runtime dependency. Array calculations are implemented in TypeScript. The chi-square survival function uses regularized incomplete-gamma calculations implemented with a convergent series and Lentz’s continued fraction.

The numerical port was checked against the upstream Python implementation: noise, outlier selection, band residuals, and chi-square agree to floating-point precision for the same input.

---

## Data format and bundled datasets

Observation files are under `src/assets/data/` and are imported as raw text at build time.

| Logical target name | Source file | Approximate size | Coverage | Use |
| --- | --- | ---: | ---: | --- |
| `data/target_spectrum.csv` | `src/assets/data/target_spectrum.csv` | 180 rows | 0.4–5.0 µm | Default target |
| `data/target_spectrum1.csv` | `src/assets/data/target_spectrum1.csv` | 300 rows | 0.4–5.0 µm | Alternate bundled target |

Expected CSV structure:

```csv
wavelength_um,transit_depth
0.4000,0.0123456
0.4257,0.0123012
```

Requirements:

- the first row is a header and is skipped;
- every later non-empty row must contain wavelength and transit depth;
- both values must parse as finite numbers;
- wavelength is in micrometers;
- transit depth is fractional, not ppm;
- rows with invalid values are ignored;
- values should be ordered by wavelength for meaningful adjacent-difference noise estimation and charting.

The source currently uses two columns. Although returned chart points include an `uncertainty` field, it is the globally estimated noise, not a third CSV column.

---

## Installation and local development

### Prerequisites

- A current JavaScript runtime compatible with Vite 8. Bun is recommended because the repository includes `bun.lock`; current Node.js with npm can also install and run the project.
- Network access to the Lovable AI gateway and arXiv for complete discovery runs.
- A valid `LOVABLE_API_KEY` available only to the server process.

No Python interpreter, separate FastAPI service, database, Docker container, or arXiv credential is required.

### 1. Clone and enter the repository

```bash
git clone https://github.com/beluhacker/exoplanet-agent-lab.git
cd exoplanet-agent-lab
```

If you are working in the Lovable editor, the project files are already available and dependencies are managed in the workspace.

### 2. Install dependencies

Using Bun:

```bash
bun install
```

Or using npm:

```bash
npm install
```

Use one package manager consistently. The checked-in lockfile is `bun.lock`.

### 3. Configure the AI key

For a local shell, provide the key to the server process without committing it:

```bash
export LOVABLE_API_KEY="your-project-key"
```

Then start the application from the same shell. In a hosted Lovable project, configure the key as a project secret. Never place it in browser code, a `VITE_` variable, the README, or a committed environment file.

The initial observation can load without this key. Literature generation, hypothesis generation, and analysis verdicts require it.

### 4. Start the development server

```bash
bun run dev
```

or:

```bash
npm run dev
```

Open the local URL printed by Vite. In the Lovable workspace, the preview is normally available on port 8080.

### 5. Verify the installation

Before running the full AI workflow:

```bash
bun run test
bun run build
```

Then open the dashboard and confirm that the spectrum appears. Select **Run Discovery Loop** to verify the AI gateway and arXiv integrations end to end.

### Production build

```bash
bun run build
bun run preview
```

The application targets an edge/serverless runtime. Keep server code compatible with Web APIs and the supported runtime; do not introduce subprocesses or native binary dependencies into server functions.

---

## Configuration

### Environment variables

| Variable | Required | Scope | Purpose |
| --- | --- | --- | --- |
| `LOVABLE_API_KEY` | Required for AI steps | Server only | Authenticates requests to the Lovable AI gateway |

There is no browser-visible API key and no direct provider key in the repository.

### Important constants

| Setting | File | Current value |
| --- | --- | --- |
| Default target | `src/server/spectrum.server.ts` | `data/target_spectrum.csv` |
| Selected target in dashboard | `src/routes/index.tsx` | `data/target_spectrum.csv` |
| Discovery iterations | `src/routes/index.tsx` | `3` |
| AI model | `src/server/agents.server.ts` | `google/gemini-3.7-flash` |
| AI timeout | `src/server/agents.server.ts` | `90,000 ms` |
| arXiv timeout | `src/server/agents.server.ts` | `20,000 ms` |
| Model parameters | `src/server/spectrum.server.ts` | `6` |
| Outlier threshold | `src/server/spectrum.server.ts` | `5 sigma` |
| Default stellar radius | server-function validation | `1.0 R_sun` |

The dashboard target and the backend default are separate constants. If changing the default target, keep both aligned.

---

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the development server |
| `bun run build` | Create a production build |
| `bun run build:dev` | Create a development-mode build |
| `bun run preview` | Serve the production build locally |
| `bun run test` | Run the Vitest suite once |
| `bun run test:watch` | Run tests in watch mode |
| `bun run lint` | Run ESLint across the repository |
| `bun run format` | Format supported files with Prettier |

Replace `bun run` with `npm run` if using npm. For the test command, `npm test` also works.

---

## Project structure

```text
.
├── README.md                         # This complete project guide
├── AGENTS.md                         # Repository-specific engineering rules
├── package.json                      # Dependencies and scripts
├── vite.config.ts                    # TanStack Start / Vite configuration
├── vitest.config.ts                  # Test configuration
├── public/                           # Static public assets
└── src/
    ├── assets/data/
    │   ├── target_spectrum.csv       # Default observation
    │   └── target_spectrum1.csv      # Alternate observation
    ├── components/ui/                # Reusable interface controls
    ├── lib/
    │   ├── discovery-types.ts        # Shared serializable types
    │   ├── discovery.functions.ts    # Validated client-callable server functions
    │   └── utils.ts                  # Shared interface utility
    ├── routes/
    │   ├── __root.tsx                # Document shell, providers, fonts, errors
    │   └── index.tsx                 # Dashboard and browser orchestrator
    ├── server/
    │   ├── agents.server.ts          # AI calls, arXiv search, agent steps
    │   └── spectrum.server.ts        # Data, physics model, statistics, metrics
    ├── test/
    │   ├── app-routing.test.tsx      # Route smoke test
    │   └── setup.ts                  # Test setup
    ├── router.tsx                    # TanStack Router creation
    ├── server.ts                     # Server entry and error wrapper
    ├── start.ts                      # Client/server-function startup logic
    └── styles.css                    # Tailwind theme and application styles
```

`src/routeTree.gen.ts` is generated by TanStack Router and must not be edited manually.

---

## Server-function reference

These are internal typed RPC functions used by the application. They are not stable public REST endpoints.

### `getObservation`

**Method:** GET
**Purpose:** Load one allow-listed observation and produce dashboard-ready summary data.

Input:

```ts
{
  target_file: "data/target_spectrum.csv" | "data/target_spectrum1.csv"
}
```

Output shape:

```ts
{
  target_file: string
  n_points: number
  wavelength_range_um: [number, number]
  median_depth_ppm: number
  min_depth_ppm: number
  max_depth_ppm: number
  noise_ppm: number
  stellar_parameters: string
  points: Array<{ wavelength: number; target: number }>
}
```

### `runLiteratureStep`

**Method:** POST
**Purpose:** Generate search queries, search arXiv, and synthesize a prior.

Input:

```ts
{
  target_file: string
  prior_experiments: Array<{
    experiment_id: string
    hypothesis: Hypothesis
    reduced_chi2: number
    band_residuals: Record<string, BandResidual>
  }>
}
```

Output:

```ts
{
  prior: string
  papers: Array<{
    title: string
    summary: string
    url: string
    published: string
  }>
  events: DiscoveryStepEvent[]
}
```

### `runExperimentStep`

**Method:** POST
**Purpose:** Propose or accept a hypothesis and score it against the target.

Input:

```ts
{
  run_id: string              // 1–64 characters
  experiment_id: string       // 1–32 characters
  target_file: string
  prior: string               // maximum 8,000 characters
  prior_experiments: PriorExperiment[]
  hypothesis?: Hypothesis     // optional deterministic override
}
```

Output:

```ts
{
  hypothesis: Hypothesis
  summary: ExperimentSummary
  spectrum: Array<{
    wavelength: number
    target: number            // ppm
    fit: number               // ppm
    uncertainty: number       // ppm
  }>
  events: DiscoveryStepEvent[]
}
```

Passing `hypothesis` bypasses AI hypothesis generation. This is useful for deterministic testing or programmatic experiments, although the current dashboard does not expose a manual parameter editor.

### `runAnalysisStep`

**Method:** POST
**Purpose:** Derive metrics for one hypothesis and generate an interpretation.

Input:

```ts
{
  run_id: string
  experiment_id: string
  hypothesis: Hypothesis
  target_file: string
  stellar_radius_rsun?: number // 0.1–5.0; default 1.0
}
```

Output:

```ts
{
  metrics: PlanetMetrics
  verdict: string
}
```

All inputs are validated with Zod before server-only code runs. Unknown target names and out-of-range parameter values are rejected at the boundary.

---

## Changing the program

### Use the alternate bundled dataset

Change `TARGET_FILE` in `src/routes/index.tsx` from:

```ts
const TARGET_FILE = "data/target_spectrum.csv";
```

to:

```ts
const TARGET_FILE = "data/target_spectrum1.csv";
```

The alternate file is already in the backend allow-list.

### Add another observation

1. Add a CSV under `src/assets/data/` using the documented two-column format.
2. Import it with `?raw` in `src/server/spectrum.server.ts`.
3. Add a logical target name and imported value to `DATASETS`.
4. Select that logical name in the dashboard or pass it to a server function.
5. Run tests and a production build.

Do not accept an arbitrary client-provided path. Keep target selection allow-listed.

### Change the number of iterations

Change `MAX_ITERATIONS` in `src/routes/index.tsx`. More iterations increase AI-gateway and arXiv traffic, runtime, and cost. The steps remain sequential.

### Change the stellar-radius assumption

The server analysis function accepts `stellar_radius_rsun` from `0.1` to `5.0`. The dashboard currently omits it, so the backend default is `1.0`. Add a validated user control and pass the value to `runAnalysisStep` if target-specific radius estimates are needed.

### Change the atmospheric model

Modify `simulateTransmissionSpectrum` in `src/server/spectrum.server.ts`. If the number of free parameters changes, update `N_MODEL_PARAMS` so degrees of freedom remain correct. Also update:

- the `Hypothesis` type;
- Zod validation in `src/lib/discovery.functions.ts`;
- hypothesis normalization and prompts in `src/server/agents.server.ts`;
- experiment display and report generation in `src/routes/index.tsx`;
- this documentation and numerical tests.

### Change the language model

Change `MODEL` in `src/server/agents.server.ts` to another model supported by the Lovable AI gateway. Review output limits and JSON behavior after changing it. Keep all gateway credentials server-side.

### Add persistence

The current application intentionally has no database. Adding saved runs requires a persistence service, a run schema, access rules, and a decision about whether discovery runs continue in the browser or move to durable background orchestration. Do not emulate persistence with server process memory; it is not reliable in a serverless environment.

---

## Testing and validation

### Automated tests

Run:

```bash
bun run test
```

The existing test verifies that the generated route tree matches `/` and renders the application route.

### Build validation

Run:

```bash
bun run build
```

A successful development session does not guarantee that newly added server dependencies support the production edge runtime. Always perform a production build after changing backend dependencies.

### Recommended end-to-end check

After changes to the discovery workflow:

1. start the application;
2. confirm the observation loads and the chart is populated;
3. start a discovery run;
4. confirm three experiment rows appear;
5. confirm the chart includes the best model;
6. confirm verdict and metrics update;
7. confirm the status becomes **Complete**;
8. inspect browser and server logs for errors.

### Numerical regression check

For model changes, compare at least one fixed hypothesis against known output for:

- estimated noise;
- excluded outliers;
- modeled depths;
- total and reduced chi-square;
- every band residual;
- derived atmosphere and molecule metrics.

Because experiments are deterministic, fixed-input regression tests should produce stable floating-point results within a defined tolerance.

---

## Troubleshooting

### The dashboard opens, but a run reports that `LOVABLE_API_KEY` is not configured

The server process cannot read the AI-gateway key. Configure `LOVABLE_API_KEY` as a server-side secret and restart the local command or redeploy. Do not prefix it with `VITE_`; that would expose it to browser code.

### The initial spectrum does not load

Check that:

- the selected `TARGET_FILE` exactly matches a key in `DATASETS`;
- the CSV import exists;
- the file has a header followed by numeric comma-separated rows;
- the application build has no import error.

### A discovery run stops at Literature, Experiment, or Analysis

Inspect the final line in **Agent Log Stream**. Common causes are:

- unavailable or invalid AI-gateway credentials;
- gateway timeout or temporary model failure;
- no network access to the AI gateway;
- malformed model output that cannot be recovered;
- a validation error caused by changed request shapes.

Run the workflow again after a transient network failure. If failures are repeatable, inspect server logs rather than exposing provider responses or credentials in the browser.

### An arXiv search fails

Individual arXiv failures are non-fatal. The Literature Agent records the failure and continues. If every query fails, it may synthesize from no papers or return an empty prior. Check network access to `export.arxiv.org` and respect the public service’s availability and rate limits.

### The fit is poor or reduced chi-square remains high

This does not necessarily indicate a software error. The simplified six-parameter model may not describe the data, the noise estimate may be too small, the language model may not have explored the best region, or the observation may contain correlated/systematic structure. Review the wavelength-band residuals before changing parameters.

### The radius looks implausible

The bundled datasets contain no stellar radius. The dashboard therefore assumes `1.0 R_sun`. Planet radius scales linearly with the assumed stellar radius. Supply the correct stellar value through `runAnalysisStep` before treating the radius as physically meaningful.

### A refresh removes the run

This is expected. Run state and the final report are held by the browser and are not persisted. Start a new run, or implement a database-backed run store if persistence is required.

### Development works but production fails after adding a package

The production backend runs in an edge/serverless environment. Avoid packages that require subprocesses, native binaries, or a conventional writable filesystem. Prefer Web APIs and pure JavaScript packages designed for edge runtimes.

---

## Security and operational notes

- `LOVABLE_API_KEY` is read inside server-side request handling and is never returned to the client.
- There are no hardcoded provider credentials in the repository.
- The target-file validator accepts only bundled allow-listed files, preventing arbitrary path access.
- Server-function inputs are validated with Zod, including string lengths and numeric ranges.
- AI responses are untrusted input. JSON responses are parsed and parameter values are normalized before they reach the scientific model.
- arXiv responses are treated as data, not instructions.
- The current server functions do not require user authentication. Anyone who can use a deployed dashboard can initiate AI calls and associated usage. Add authentication and server-side rate limiting before exposing a cost-sensitive public deployment.
- The application stores no user profiles, uploaded observations, or discovery history.
- Do not log, commit, display, or send the AI key to the browser.

---

## Known limitations

- The forward model contains only fixed Gaussian H2O, CO2, and CH4 bands plus a simple haze law.
- Abundance coefficients are phenomenological amplitudes, not physical mixing ratios.
- There is no temperature-pressure profile, radiative-transfer solver, cloud deck, stellar contamination model, or instrument response model.
- Noise is represented by one estimated white-noise value; wavelength-dependent uncertainties and covariance are not supported.
- The three-iteration search is guided by a language model and is not a formal optimizer or posterior sampler.
- The “best” model is best only among the hypotheses generated in that run.
- Detection significances are approximate diagnostics and do not marginalize over all parameters.
- The assumed stellar radius defaults to the solar radius.
- Runs are not resumable or persistent.
- arXiv results depend on live network availability and search output at run time.
- The dashboard does not currently provide dataset upload, target selection, manual parameter entry, report download, authentication, or multi-user run management.

---

## Provenance and license

This application is a TypeScript migration of [beluhacker/exoplanet-agent-lab](https://github.com/beluhacker/exoplanet-agent-lab).

| Upstream Python project | Current full-stack application |
| --- | --- |
| `backend/simulator.py` | `src/server/spectrum.server.ts` |
| `backend/lab_tools.py` | `src/server/spectrum.server.ts` |
| `backend/orchestrator.py` | `src/server/agents.server.ts` plus browser orchestration |
| FastAPI observation and discovery endpoints | TanStack Start server functions |
| React frontend | `src/routes/index.tsx` and `src/styles.css` |
| `data/*.csv` | Bundled raw-text assets under `src/assets/data/` |
| Omnigent subprocess and filesystem run results | Stateless serverless steps and browser-held run state |

The upstream repository does not include an explicit license. This migrated project therefore has no explicit open-source license unless the repository owner adds one. The bundled observation data originates from the upstream repository. Without a license, normal copyright restrictions apply; contact the repository owner before redistributing or reusing the code or data outside the permissions granted by the hosting platform.
