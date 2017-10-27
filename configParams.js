import _ from 'lodash';
import fs from 'fs';
import parseArgs from 'minimist';

export default class ConfigParams {
  constructor(cmdLineArgs, options) {
    const argv = parseArgs(cmdLineArgs, options.minimist);
    this.cfgFileError = false;
    this.cfgFilename = argv.config || `${process.cwd()}/bunny-migrate.cfg`;
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(this.cfgFilename).toString());
    } catch (e) {
      this.cfgFileError = true;
    }
    this.params = _.merge({}, config, argv);
  }

  get(keys) {
    if (!_.isArray(keys)) { return this.params[keys]; }
    const key = _.find(keys, (k) => (this.params[k] !== undefined));
    return this.params[key];
  }

  setOptions(options) {
    this.logger = options.logger;
    this.terminate = options.terminate;
    if (this.cfgFileError) {
      const message = `[ConfigParams] cannot read or parse configuration file "${this.cfgFilename}"!`;
      if (!this.params.config) {
        this.logger.warn(message);
      } else {
        this.terminate(message);
      }
    }
    this.logger.debug(`[ConfigParams] provided parameters: ${JSON.stringify(this.params, null, 2)}`);
  }

  getOneCommand() {
    if (!this.params._.length) { this.terminate('[ConfigParams] missing command'); }
    if (this.params._.length !== 1) { this.terminate('[ConfigParams] too many commands, expected just one'); }
    return this.params._[0];
  }

  ensure(input) {
    const keys = _.isArray(input) ? input : [input];
    const missing = [];
    _.forEach(keys, (key) => {
      if (this.params[key] === undefined) {
        missing.push(key);
      }
    });
    if (missing.length) {
      this.terminate(`[ConfigParams] expected parameter(s) ["${missing.join('", "')}"] not provided!`);
    }
  }
}
