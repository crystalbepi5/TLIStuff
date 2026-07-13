export {
  BASE_URL,
  DEFAULT_CONFIG,
  fetchPath,
  extractSlugs,
  indexSlugs,
  firstCard,
  parseSkill,
  mapActiveSkill,
  scrapeActiveSkills,
  parseModifiers,
  parseSupport,
  scrapeSupports,
  type TlidbConfig,
  type ParsedSkill
} from './scrape.js';

export {
  BUNDLE_BASE,
  DATA_VERSION,
  fetchBundle,
  leaves,
  mapGear,
  mapLegendaries,
  mapHeroTraits,
  mapSkills,
  scrapeGear,
  scrapeLegendaries,
  scrapeHeroTraits,
  scrapeSkillsFromBundles
} from './tlicompendium.js';
