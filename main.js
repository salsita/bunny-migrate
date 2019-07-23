import winston from 'winston';

import ConfigParams from './configParams';
import RabbitClient from './rabbitClient';
import RabbitSchema from './rabbitSchema';
import { prettyError } from './utils';
import version from './version';

const run = () => {
  const cfgParams = new ConfigParams(process.argv.slice(2), { minimist: { string: ['config', 'uri', 'bunny-x', 'schema', 'prefix'] } });
  const logger = winston.createLogger({
    level: cfgParams.get(['d', 'debug']) ? 'debug' : cfgParams.get(['q', 'quiet']) ? 'error' : 'info', // eslint-disable-line no-nested-ternary
    transports: [new winston.transports.Console()],
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.printf((info) => `${info.timestamp} (${info.level}): ${info.message}`)
    )
  });
  const client = new RabbitClient(logger, cfgParams.get(['force', 'f']));
  const schema = new RabbitSchema(logger);

  // helpers, signal handlers

  const terminate = (msg) => {
    client.disconnect();
    logger.error(`${msg}\nFor help please see https://github.com/salsita/bunny-migrate/blob/master/README.md`);
    process.exit(1);
  };

  logger.info(`[Main] ${version.name}, version ${version.number}`);
  cfgParams.setOptions({ logger, terminate });

  const sigHandler = () => { terminate('[Main] signal received, terminating'); };
  process.on('SIGINT',  sigHandler);
  process.on('SIGTERM', sigHandler);

  // help / version

  const helpMessage = `Supported commands: init, list, add, remove, add-rule, remove-rule, update-rule; help, version.
For more help please see https://github.com/salsita/bunny-migrate/blob/master/README.md`;
  if (cfgParams.get(['v', 'version'])) { process.exit(0); }
  if (cfgParams.get(['h', 'help'])) {
    logger.info(helpMessage);
    process.exit(0);
  }

  const command = cfgParams.getOneCommand();

  if (command === 'version') { process.exit(0); }
  if (command === 'help') {
    logger.info(helpMessage);
    process.exit(0);
  }

  cfgParams.ensure(['uri', 'bunny-x']);

  // command-based switch, async code wrapper

  async function main() {
    await client.connect(cfgParams.get('uri'), cfgParams.get('bunny-x'));

    logger.info(`[Main] processing command "${command}"`);
    let args;

    switch (command) {
      case 'init':
        await client.createAdminXQ();
        break;

      case 'list':
        const info = await client.readAdminMessage(true);
        logger.info(`[Main] Run-time information about RabbitMQ setup:
* schemas: ${JSON.stringify(info.schemas, null, 2)}
* rules: ${JSON.stringify(info.rules, null, 2)}`);
        break;

      case 'add':
        cfgParams.ensure(['schema', 'prefix']);
        const updateRule = cfgParams.get('update-rule');
        if (updateRule) {
          cfgParams.ensure(['prefix', 'destination', 'source', 'key']);
          schema.validateRoutingKey(cfgParams.get('key'));
          args = schema.validateArgs(cfgParams.get('args'));
        }
        const validSchema = await schema.load(cfgParams.get('schema'));
        await client.addSchema(validSchema, cfgParams.get('prefix'));
        if (updateRule) {
          await client.removeRule(cfgParams.get('key'), true);
          await client.addRule(cfgParams.get('prefix'), cfgParams.get('destination'), cfgParams.get('source'), cfgParams.get('key'), args);
        }
        break;

      case 'remove':
        cfgParams.ensure('prefix');
        await client.removeSchema(cfgParams.get('prefix'));
        break;

      case 'add-rule':
        cfgParams.ensure(['prefix', 'destination', 'source', 'key']);
        schema.validateRoutingKey(cfgParams.get('key'));
        args = schema.validateArgs(cfgParams.get('args'));
        await client.addRule(cfgParams.get('prefix'), cfgParams.get('destination'), cfgParams.get('source'), cfgParams.get('key'), args);
        break;

      case 'remove-rule':
        cfgParams.ensure('key');
        schema.validateRoutingKey(cfgParams.get('key'));
        await client.removeRule(cfgParams.get('key'));
        break;

      case 'update-rule':
        cfgParams.ensure(['prefix', 'destination', 'source', 'key']);
        schema.validateRoutingKey(cfgParams.get('key'));
        await client.removeRule(cfgParams.get('key'), true);
        args = schema.validateArgs(cfgParams.get('args'));
        await client.addRule(cfgParams.get('prefix'), cfgParams.get('destination'), cfgParams.get('source'), cfgParams.get('key'), args);
        break;

      default:
        terminate(`[Main] unsupported command "${command}"!`);
    }
  }

  // async code runner
  main()
    .then(() => {
      client.disconnect();
      logger.info('[Main] finished successfully.');
      process.exit(0);
    })
    .catch((err) => { terminate(prettyError(err)); });
};

module.exports = run; // for the runner in bin directory
