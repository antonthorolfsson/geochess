/** The simulator's public face: what the server's parity test and the CLIs use. */
export { makeBots, type Bots } from './bots';
export { DEFAULT_KNOBS, knobsFor, type BotKnobs } from './bots/knobs';
export { loadDataset } from './dataset';
export { DEFAULT_CHESS } from './engine/chess';
export { runCampaign } from './engine/engine';
export type { SimAction, SimConfig, SimState } from './engine/types';
export { recordOf, type CampaignRecord } from './record';
export { LATENCY, SCENARIOS, baseConfig, runScenarioCampaign, scenarioConfig } from './scenarios';
