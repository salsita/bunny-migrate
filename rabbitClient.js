import AmqpLib from 'amqplib';
import _ from 'lodash';

import { wait, getStamp } from './utils';

const EMPTY_ADMIN_OBJ = { schemas: {}, rules: {} };
const ADMIN_ROUTING_KEY = 'admin';
const WAIT_FOR_SENDING = 250;  // ms

export default class RabbitClient {
  constructor(logger, force) {
    this.logger = logger;
    this.logger.debug(`[RabbitClient] constructor(logger, force = ${force})`);
    this.force = force;
  }

  async connect(uri, adminXQ) {
    this.logger.debug(`[RabbitClient] connect(uri = "${uri}", adminXQ = "${adminXQ}")`);
    this.uri = uri;
    this.adminXQ = adminXQ;
    this.connection = await AmqpLib.connect(uri);
    this.connection.on('error', this.handleConnectionEvent.bind(this, 'error'));
    this.connection.on('close', this.handleConnectionEvent.bind(this, 'close'));
    await this.createChannel();
  }

  handleConnectionEvent(ev, ...args) {
    this.logger.debug(`[RabbitClient] handleConnectionEvent(ev = "${ev}", ...args = ${args})`);
    this.logger.error(`[RabbitClient] connection event "${ev}", terminating`);
    process.exit(1);
  }

  async createChannel() {
    this.logger.debug('[RabbitClient] createChannel()');
    this.channel = await this.connection.createChannel();
    this.channel.prefetch(1);
    this.channel.on('error', this.handleChannelEvent.bind(this, 'error'));
    this.channel.on('close', this.handleChannelEvent.bind(this, 'close'));
  }

  handleChannelEvent(ev, ...args) {
    this.logger.debug(`[RabbitClient] handleChannelEvent(ev = "${ev}", ...args = ${args})`);
  }

  async disconnect() {
    this.logger.debug('[RabbitClient] disconnect()');
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  async createAdminXQ() {
    this.logger.debug(`[RabbitClient] createAdminXQ()`);
    const name = this.adminXQ;

    this.logger.info(`[RabbitClient] checking for admin exchange "${name}"`);
    try {
      await this.checkExchange('', name, false);
    } catch (e) {
      if (!this.force) {
        throw e;
      } else {
        this.logger.warn(`${e.message}, removing it now!`);
        await this.removeExchange('', name);
      }
    }

    this.logger.info(`[RabbitClient] checking for admin queue "${name}"`);
    try {
      await this.checkQueue('', name, false);
    } catch (e) {
      if (!this.force) {
        throw e;
      } else {
        this.logger.warn(`${e.message}, removing it now!`);
        await this.removeQueue('', name);
      }
    }

    this.logger.info(`[RabbitClient] creating admin exchange "${name}"`);
    await this.createExchange('', { name, type: 'direct' });

    this.logger.info(`[RabbitClient] creating admin queue "${name}"`);
    await this.createQueue('', { name });

    this.logger.info('[RabbitClient] binding admin queue to admin exchange');
    await this.createQueueBinding('', { queue: name, exchange: name, pattern: ADMIN_ROUTING_KEY });

    this.logger.info('[RabbitClient] publishing run-time info');
    await this.publishJSON(name, ADMIN_ROUTING_KEY, EMPTY_ADMIN_OBJ, { persistent: true });
  }

  async checkExchange(prefix, exchange, expectToExist) {
    this.logger.debug(`[RabbitClient] checkExchange(prefix = "${prefix}", exchange = "${exchange}", expectToExist = ${expectToExist})`);
    const name = this.prefixName(prefix, exchange);
    let result;
    try {
      await this.channel.checkExchange(name);
      if (!expectToExist) { result = `[RabbitClient] exchange "${name}" already exists!`; }
    } catch (e) {
      await this.createChannel();
      if (expectToExist) { result = `[RabbitClient] exchange "${name}" does not exist!`; }
    }
    if (result) { throw new Error(result); }
  }

  async checkQueue(prefix, queue, expectToExist) {
    this.logger.debug(`[RabbitClient] checkingQueue(prefix = "${prefix}", queues = "${queue}", expectToExist = ${expectToExist})`);
    const name = this.prefixName(prefix, queue);
    let result;
    try {
      await this.channel.checkQueue(name);
      if (!expectToExist) { result = `[RabbitClient] queue "${name}" already exists!`; }
    } catch (e) {
      await this.createChannel();
      if (expectToExist) { result = `[RabbitClient] queue "${name}" does not exist!`; }
    }
    if (result) { throw new Error(result); }
  }

  prefixName(prefix, name) {
    return (prefix.length) ? `${prefix}.${name}` : name;
  }

  async throwOrWarn(message, waitForChannel = true) {
    if (!this.force) {
      throw new Error(message);
    } else {
      this.logger.warn(message);
      if (waitForChannel) {
        await this.createChannel();
      }
    }
  }

  async removeExchange(prefix, exchange) {
    this.logger.debug(`[RabbitClient] removeExchange(prefix = "${prefix}", exchange = "${exchange}")`);
    const name = this.prefixName(prefix, exchange);
    try {
      await this.channel.deleteExchange(name);
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot remove exchange "${name}"!`);
    }
  }

  async removeQueue(prefix, queue) {
    this.logger.debug(`[RabbitClient] removeQueue(prefix = "${prefix}", queue = "${queue}")`);
    const name = this.prefixName(prefix, queue);
    try {
      await this.channel.deleteQueue(name);
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot remove queue "${name}"!`);
    }
  }

  async createExchange(prefix, exchange, names = []) {
    this.logger.debug(`[RabbitClient] createExchange(prefix = "${prefix}", exchange = { name: "${exchange.name}", type: "${exchange.type}", ... }, names [${names.length}])`);
    const name = this.prefixName(prefix, exchange.name);
    try {
      await this.channel.assertExchange(name, exchange.type, this.prefixParamObj(prefix, names, exchange.options));
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot create exchange "${name}" of type "${exchange.type}"!`);
    }
  }

  async createQueue(prefix, queue, names = []) {
    this.logger.debug(`[RabbitClient] createQueue(prefix = "${prefix}", queue = { name: "${queue.name}", ... }, names [${names.length}])`);
    const name = this.prefixName(prefix, queue.name);
    try {
      await this.channel.assertQueue(name, this.prefixParamObj(prefix, names, queue.options));
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot create queue "${name}"!`);
    }
  }

  async createQueueBinding(prefix, binding, names = []) {
    this.logger.debug(`[RabbitClient] createQueueBinding(prefix = "${prefix}", bindings = { queue: "${binding.queue}", exchange: "${binding.exchange}", pattern: "${binding.pattern}", ... }, names [${names.length}])`);
    const queueName = this.prefixName(prefix, binding.queue);
    const exchangeName = this.prefixName(prefix, binding.exchange);
    try {
      await this.channel.bindQueue(queueName, exchangeName, binding.pattern, this.prefixParamObj(prefix, names, binding.args));
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot bind queue "${queueName}" to exchange "${exchangeName}"!`);
    }
  }

  async createExchangeBinding(prefix, binding, names = []) {
    this.logger.debug(`[RabbitClient] createExchangeBinding(prefix = "${prefix}", bindings = { destination = "${binding.destination}", source = "${binding.source}", pattern = "${binding.pattern}", ... }, names [${names.length}])`);
    const sourceName = this.prefixName(prefix, binding.source);
    const destName = this.prefixName(prefix, binding.destination);
    try {
      await this.channel.bindExchange(destName, sourceName, binding.pattern, this.prefixParamObj(prefix, names, binding.args));
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot bind exchange "${destName}" to exchange "${sourceName}"!`);
    }
  }

  async removeExchangeBinding(prefix, binding, names = []) {
    this.logger.debug(`[RabbitClient] removeExchangeBinding(prefix = "${prefix}", bindings = { destination = "${binding.destination}", source = "${binding.source}", pattern = "${binding.pattern}", ... }, names [${names.length}])`);
    const sourceName = this.prefixName(prefix, binding.source);
    const destName = this.prefixName(prefix, binding.destination);
    try {
      await this.channel.unbindExchange(destName, sourceName, binding.pattern, this.prefixParamObj(prefix, names, binding.args));
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot unbind exchange "${destName}" from exchange "${sourceName}"!`);
    }
  }

  async publishJSON(exchange, routingKey, json, options) {
    this.logger.debug(`[RabbitClient] publishJSON(exchange = "${exchange}", routingKey = "${routingKey}", json = ${JSON.stringify(json)}, options = ${JSON.stringify(options)})`);
    const sent = this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(json, null, 2)), options);
    if (!sent) {
      await this.throwOrWarn('[RabbitClient] could not publish the run-time info!', false);
    } else {
      await wait(WAIT_FOR_SENDING);
    }
  }

  async readAdminMessage(recover = false) {
    this.logger.debug(`[RabbitClient] readAdminMessage(recover = ${recover})`);
    let msg;
    try {
      msg = await this.channel.get(this.adminXQ);
      if (recover) { await this.channel.recover(); }
      if (msg) {
        // for acking the message later
        this.adminMsg = msg;
        this.adminChannel = this.channel;
        await this.createChannel();
      }
      msg = JSON.parse(msg.content.toString());
      msg.schemas = msg.schemas || {};
      msg.rules = msg.rules || {};
      return msg;
    } catch (e) {
      await this.throwOrWarn(`[RabbitClient] cannot read and parse admin message from queue "${this.adminXQ}"!`);
      return _.cloneDeep(EMPTY_ADMIN_OBJ);
    }
  }

  async ackAdminMessage() {
    this.logger.debug('[RabbitClient] ackAdminMessage()');
    let canAck = true;
    if (this.adminMsg && this.adminChannel) {
      try {
        await this.adminChannel.ack(this.adminMsg);
      } catch (e) {
        canAck = false;
      }
    } else {
      canAck = false;
    }
    if (!canAck) {
      this.throwOrWarn(`[RabbitClient] cannot acknowledge admin message in "${this.adminXQ}" queue!`);
    } else {
      await wait(WAIT_FOR_SENDING);
    }
  }

  async addSchema(schema, prefix) {
    this.logger.debug(`[RabbitClient] addSchema(schema, prefix = "${prefix}")`);

    const adminMsg = await this.readAdminMessage();
    if (_.includes(_.keys(adminMsg.schemas), prefix)) {
      await this.throwOrWarn(`[RabbitClient] prefix "${prefix}" already used!`, false);
    }

    // check entities

    const exchangeNames = _.map(schema.exchanges, 'name');
    this.logger.info(`[RabbitClient] checking exchanges to be created ["${exchangeNames.join('", "')}"]`);
    await this.checkExchanges(prefix, exchangeNames, false);

    const queueNames = _.map(schema.queues, 'name');
    this.logger.info(`[RabbitClient] checking queues to be created ["${queueNames.join('", "')}"]`);
    await this.checkQueues(prefix, queueNames, false);

    // create the entities

    const names = _.union(exchangeNames, queueNames);
    let i, j;

    this.logger.info(`[RabbitClient] creating exchanges ["${exchangeNames.join('", "')}"]`);
    for (i = 0; i < schema.exchanges.length; i++) { await this.createExchange(prefix, schema.exchanges[i], names); }

    this.logger.info(`[RabbitClient] creating queues ["${queueNames.join('", "')}"]`);
    for (i = 0; i < schema.queues.length; i++) { await this.createQueue(prefix, schema.queues[i], names); }

    this.logger.info(`[RabbitClient] binding queues to exchanges [${schema.queueBindings.length}]`);
    for (i = 0; i < schema.queueBindings.length; i++) { await this.createQueueBinding(prefix, schema.queueBindings[i], names); }

    this.logger.info(`[RabbitClient] binding exchanges to exchanges [${schema.exchangeBindings.length}]`);
    for (i = 0; i < schema.exchangeBindings.length; i++) { await this.createExchangeBinding(prefix, schema.exchangeBindings[i], names); }

    // push messages

    this.logger.info(`[RabbitClient] pushing initial messages to exchanges / queues [${schema.messages.length}]`);
    for (i = 0; i < schema.messages.length; i++) {
      const message = schema.messages[i];
      let sent;
      for (j = 0; j < message.count; j++) {
        if (message.exchange) {
          sent = this.channel.publish(this.prefixName(prefix, message.exchange), message.key, Buffer.from(message.content), message.options);
        } else {
          sent = this.channel.sendToQueue(this.prefixName(prefix, message.queue), Buffer.from(message.content), message.options);
        }
        if (!sent) {
          await this.throwOrWarn(`[RabbitClient] could not publish copy #${j + 1} of message #${i + 1}!`, false);
        }
      }
      await wait(WAIT_FOR_SENDING);
    }

    // update run-time info

    adminMsg.schemas[prefix] = {
      timestamp: getStamp(),
      exchanges: exchangeNames,
      queues: queueNames
    };
    this.logger.info('[RabbitClient] publishing updated run-time info');
    await this.publishJSON(this.adminXQ, ADMIN_ROUTING_KEY, adminMsg, { persistent: true });
    await this.ackAdminMessage();
  }

  async checkExchanges(prefix, exchanges, expectToExist) {
    this.logger.debug(`[RabbitClient] checkExchanges(prefix = "${prefix}", exchanges, expectToExist = ${expectToExist})`);
    for (let i = 0; i < exchanges.length; i++) {
      try {
        await this.checkExchange(prefix, exchanges[i], expectToExist);
      } catch (e) {
        await this.throwOrWarn(e.message, false);
      }
    }
  }

  async checkQueues(prefix, queues, expectToExist) {
    this.logger.debug(`[RabbitClient] checkQueues(prefix = "${prefix}", queues, expectToExist = ${expectToExist})`);
    for (let i = 0; i < queues.length; i++) {
      try {
        await this.checkQueue(prefix, queues[i], expectToExist);
      } catch (e) {
        await this.throwOrWarn(e.message, false);
      }
    }
  }

  prefixParamArr(prefix, names, arr) {
    if (!arr.length) { return []; }
    this.logger.debug(`[RabbitClient] (inner) prefixParamArr(prefix = "${prefix}", names [${names.length}], arr = ${JSON.stringify(arr)})`);
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (typeof item === 'string') {
        if (names.indexOf(item) === -1) {
          result.push(item);
        } else {
          result.push(this.prefixName(prefix, item));
        }
      } else if (typeof item === 'object') {
        if (item.constructor === Array) {
          result.push(this.prefixParamArr(prefix, names, item));
        } else {
          result.push(this.prefixParamObj(prefix, names, item, true));
        }
      } else {
        result.push(item);
      }
    }
    this.logger.debug(`<--- result = ${JSON.stringify(result)}`);
    return result;
  }

  prefixParamObj(prefix, names, obj, inner = false) {
    if (!obj) { return obj; }
    this.logger.debug(`[RabbitClient] ${inner ? '(inner) ' : ''}prefixParamObj(prefix = "${prefix}", names [${names.length}], obj = ${JSON.stringify(obj)})`);
    const result = {};
    Object.keys(obj).forEach((key) => {
      if (typeof obj[key] === 'string') {
        if (names.indexOf(obj[key]) === -1) {
          result[key] = obj[key];
        } else {
          result[key] = this.prefixName(prefix, obj[key]);
        }
      } else if (typeof obj[key] === 'object') {
        if (obj[key].constructor === Array) {
          result[key] = this.prefixParamArr(prefix, names, obj[key]);
        } else {
          result[key] = this.prefixParamObj(prefix, names, obj[key], true);
        }
      } else {
        result[key] = obj[key];
      }
    });
    this.logger.debug(`<--- result = ${JSON.stringify(result)}`);
    return result;
  }

  async removeSchema(prefix) {
    this.logger.debug(`[RabbitClient] removeSchema(prefix = "${prefix}")`);

    const adminMsg = await this.readAdminMessage();
    if (!_.includes(_.keys(adminMsg.schemas), prefix)) {
      throw new Error(`[RabbitClient] no run-time information about prefix "${prefix}"!`);
    }

    // check if the prefix is NOT referenced from adminMsg.rules

    const prefixToKey = {};
    _.each(adminMsg.rules, (rule, key) => {
      prefixToKey[rule.prefix] = prefixToKey[rule.prefix] || [];
      prefixToKey[rule.prefix].push(key);
    });
    if (prefixToKey[prefix]) {
      await this.throwOrWarn(`[RabbitClient] schema instance with prefix "${prefix}" is referenced from managed rule(s) ["${prefixToKey[prefix].join('", "')}"]!`, false);
    }

    // check entities
    let i;

    const queueNames = adminMsg.schemas[prefix].queues;
    this.logger.info(`[RabbitClient] checking queues to be removed ["${queueNames.join('", "')}"]`);
    await this.checkQueues(prefix, queueNames, true);

    const exchangeNames = adminMsg.schemas[prefix].exchanges;
    this.logger.info(`[RabbitClient] checking exchanges to be removed ["${exchangeNames.join('", "')}"]`);
    await this.checkExchanges(prefix, exchangeNames, true);

    // remove the entities

    this.logger.info(`[RabbitClient] removing queues ["${queueNames.join('", "')}"]`);
    for (i = 0; i < queueNames.length; i++) { await this.removeQueue(prefix, queueNames[i]); }

    this.logger.info(`[RabbitClient] removing exchanges ["${exchangeNames.join('", "')}"]`);
    for (i = 0; i < exchangeNames.length; i++) { await this.removeExchange(prefix, exchangeNames[i]); }

    // update run-time info

    adminMsg.schemas[prefix] = undefined;
    this.logger.info('[RabbitClient] publishing updated run-time info');
    await this.publishJSON(this.adminXQ, ADMIN_ROUTING_KEY, adminMsg, { persistent: true });
    await this.ackAdminMessage();
  }

  keyToPattern(key) {
    return `${key}.#`;
  }

  async addRule(prefix, destination, source, key, args) {
    this.logger.debug(`[RabbitClient] addRule(prefix = "${prefix}", destination = "${destination}", source = "${source}", key = "${key}", args)`);

    const adminMsg = await this.readAdminMessage();
    if (!_.includes(_.keys(adminMsg.schemas), prefix)) {
      await this.throwOrWarn(`[RabbitClient] no run-time information about prefix "${prefix}"!`, false);
    }
    if (_.includes(_.keys(adminMsg.rules), key)) {
      await this.throwOrWarn(`[RabbitClient] there is already existing rule for routing key "${key}"!`, false);
    }
    const exchanges = (adminMsg.schemas[prefix] || {}).exchanges || [];
    if (!_.includes(exchanges, destination)) {
      await this.throwOrWarn(`[RabbitClient] destination exchange "${destination}" was not created as part of schema instance with prefix "${prefix}"!`, false);
    }
    const dest = this.prefixName(prefix, destination);
    const names = [dest, source];
    this.logger.info(`[RabbitClient] checking exchanges ["${names.join('", "')}"]`);
    await this.checkExchanges('', names, true);

    // create binding

    const pattern = this.keyToPattern(key);
    this.logger.info(`[RabbitClient] binding exchange "${dest}" to exchange "${source}"`);
    await this.createExchangeBinding('', { destination: dest, source, pattern, args: this.prefixParamObj(prefix, [destination], args) });

    // update run-time info

    adminMsg.rules = adminMsg.rules || {};
    adminMsg.rules[key] = {
      timestamp: getStamp(),
      prefix,
      destination,
      source,
      args
    };
    this.logger.info('[RabbitClient] publishing updated run-time info');
    await this.publishJSON(this.adminXQ, ADMIN_ROUTING_KEY, adminMsg, { persistent: true });
    await this.ackAdminMessage();
  }

  async removeRule(key, warnOnMissingKey = false) {
    this.logger.debug(`[RabbitClient] removeRule(key = "${key}")`);

    const adminMsg = await this.readAdminMessage();
    if (!_.includes(_.keys(adminMsg.rules), key)) {
      const message = `[RabbitClient] no run-time information about managed rule with routing key "${key}"!`;
      if (warnOnMissingKey) {
        this.logger.warn(message);
        if (this.adminChannel) { await this.adminChannel.recover(); }
        return;
      } else {
        throw new Error(message);
      }
    }

    // check exchanges

    const rule = adminMsg.rules[key];
    const dest = this.prefixName(rule.prefix, rule.destination);
    const names = [dest, rule.source];
    this.logger.info(`[RabbitClient] checking exchanges ["${names.join('", "')}"]`);
    await this.checkExchanges('', names, true);

    // remove the rule (binding)

    const pattern = this.keyToPattern(key);
    this.logger.info(`[RabbitClient] removing binding between exchanges "${dest}" and "${rule.source}" with routing key "${key}"`);
    await this.removeExchangeBinding('', {
      destination: dest,
      source: rule.source,
      pattern,
      args: this.prefixParamObj(rule.prefix, [rule.destination], rule.args)
    });

    // update run-time info

    adminMsg.rules[key] = undefined;
    this.logger.info('[RabbitClient] publishing updated run-time info');
    await this.publishJSON(this.adminXQ, ADMIN_ROUTING_KEY, adminMsg, { persistent: true });
    await this.ackAdminMessage();
  }
}
