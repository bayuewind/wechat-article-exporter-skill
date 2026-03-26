const { createSkillHandler } = require('./skill-core.cjs');

const handler = createSkillHandler();

module.exports = async function run(input, context) {
  return handler(input, context);
};

module.exports.run = module.exports;
