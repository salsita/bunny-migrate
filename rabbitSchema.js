import fs from 'fs';
import _ from 'lodash';
import util from 'util';

const asyncReadFile = util.promisify(fs.readFile);

export default class RabbitSchema {
  constructor(logger) {
    this.logger = logger;
  }

  // read, parse, validate
  async load(schemaFilename) {
    this.logger.debug(`[RabbitSchema] load(schemaFilename = "${schemaFilename}")`);
    let buffer;
    let schema;
    // read
    try {
      buffer = await asyncReadFile(schemaFilename);
    } catch (e) {
      throw new Error(`[RabbitSchema] cannot read schema file "${schemaFilename}"!`);
    }
    // parse
    try {
      schema = JSON.parse(buffer.toString());
    } catch (e) {
      throw new Error(`[RabbitSchema] cannot parse data from file "${schemaFilename}"!`);
    }
    // validate
    this.validateSchema(schema);
    return schema;
  }

  validateRoutingKey(key) {
    const invalid = [' ', '.', '*', '#'];
    if (!key.length) {
      throw new Error('[RabbitSchema] empty routing key!');
    }
    if (_.some(invalid, (char) => _.includes(key, char))) {
      throw new Error(`[RabbitSchema] routing key "${key}" contains invalid character(s)!`);
    }
  }

  validateArgs(args) {
    if (!args || _.isObject(args)) {
      return args;
    }

    if (!_.isString(args)) {
      throw new Error(`[RabbitSchema] provided args (${args}) of invalid type!`);
    }

    try {
      const result = JSON.parse(args);
      return result;
    } catch (e) {
      throw new Error(`[RabbitSchema] cannot convert args string "${args}" to an object!`);
    }
  }

  // --- internal methods below ---

  validateSchema (schema) {
    this.logger.debug('[RabbitSchema] validateSchema(schema)');
    // root
    const rootArrays = ['exchanges', 'queues', 'queueBindings', 'exchangeBindings', 'messages'];
    _.forEach(_.keys(schema), (key) => {
      if (!_.some(rootArrays, (name) => (name === key))) {
        throw new Error(`[RabbitSchema] unsupported schema object key "${key}" found!`);
      }
      if (!_.isArray(schema[key])) {
        throw new Error(`[RabbitSchema] schema key "${key}" is not an array!`);
      }
    });
    _.forEach(rootArrays, (key) => { schema[key] = schema[key] || []; });
    // typeof for individual fields
    const types = {
      name: 'string',
      type: 'string',
      options: 'object',
      exchange: 'string',
      queue: 'string',
      pattern: 'string',
      args: 'object',
      source: 'string',
      destination: 'string',
      key: 'string',
      count: 'number',
      content: ['string', 'object']
    };
    this.validateArray(schema, 'exchanges', { name: true, type: true, options: false }, types);
    this.validateArray(schema, 'queues', { name: true, options: false }, types);
    this.validateArray(schema, 'queueBindings', { exchange: true, queue: true, pattern: true, args: false }, types);
    this.validateArray(schema, 'exchangeBindings', { source: true, destination: true, pattern: true, args: false }, types);
    this.validateArray(schema, 'messages', { exchange: false, queue: false, key: false, content: true, count: false, options: false }, types);
    // exchange type enums, exchange name uniqueness
    const exchangeTypes = ['direct', 'fanout', 'topic', 'headers'];
    const exchangeNames = [];
    _.forEach(schema.exchanges, (exchange, idx) => {
      if (!_.some(exchangeTypes, (type) => (type === exchange.type))) {
        throw new Error(`[RabbitSchema] value of field "type" of item #${idx + 1} in schema array "exchanges" is invalid (expected: "direct", "fanout", "topic", or "headers", actual: "${exchange.type}")!`);
      }
      if (_.some(exchangeNames, (val) => (val === exchange.name))) {
        throw new Error(`[RabbitSchema] exchange with name "${exchange.name}" defined multiple times!`);
      }
      exchangeNames.push(exchange.name);
    });
    // queue names uniqueness
    const queueNames = [];
    _.forEach(schema.queues, (queue) => {
      if (_.some(queueNames, (name) => (name === queue.name))) {
        throw new Error(`[RabbitSchema] queue with name "${queue.name}" defined multiple times!`);
      }
      queueNames.push(queue.name);
    });
    // exchange-to-queue binding references
    _.forEach(schema.queueBindings, (binding, idx) => {
      if (!_.some(exchangeNames, (name) => (name === binding.exchange))) {
        throw new Error(`[RabbitSchema] exchange-to-queue binding #${idx + 1} references unknown exchange "${binding.exchange}"!`);
      }
      if (!_.some(queueNames, (name) => (name === binding.queue))) {
        throw new Error(`[RabbitSchema] exchange-to-queue binding #${idx + 1} references unknown queue "${binding.queue}"!`);
      }
    });
    // exchange-to-exchange binding references
    _.forEach(schema.exchangeBindings, (binding, idx) => {
      if (!_.some(exchangeNames, (name) => (name === binding.source))) {
        throw new Error(`[RabbitSchema] exchange-to-exchange binding #${idx + 1} references unknown source exchange "${binding.source}"!`);
      }
      if (!_.some(exchangeNames, (name) => (name === binding.destination))) {
        throw new Error(`exchange-to-exchange binding #${idx + 1} references unknown destination exchange "${binding.destination}"!`);
      }
    });
    // messages
    _.forEach(schema.messages, (message, idx) => {
      if (!message.exchange && !message.queue) {
        throw new Error(`[RabbitSchema] messsage #${idx + 1} is missing the target (exchange or queue name)!`);
      }
      if (message.exchange && message.queue) {
        throw new Error(`[RabbitSchema] message #${idx + 1} has both exchange and queue specified, pick just one!`);
      }
      if (message.exchange && typeof message.key !== 'string') {
        throw new Error(`[RabbitSchema] routing key missing for message #${idx + 1} (routed to exchange "${message.exchange}")!`);
      }
      if (message.exchange && !_.some(exchangeNames, (name) => (name === message.exchange))) {
        throw new Error(`[RabbitSchema] message #${idx + 1} references unknown exchange "${message.exchange}"!`);
      }
      if (message.queue && !_.some(queueNames, (name) => (name === message.queue))) {
        throw new Error(`[RabbitSchema] message #${idx + 1} references unknown queue "${message.queue}"!`);
      }
      if (typeof message.content === 'object') { message.content = JSON.stringify(message.content, null, 2); }
      message.count = message.count || 1;
    });
  }

  validateArray(schema, arr, keys, types) {
    this.logger.debug(`[RabbitSchema] validateArray(schema, arr = "${arr}", keys, types)`);
    if (!schema[arr]) {
      return;
    }
    const names = _.keys(keys);
    _.forEach(schema[arr], (item, idx) => {
      if (!_.isObject(item)) {
        throw new Error(`[RabbitSchema] item #${idx + 1} in schema array "${arr}" is not an object!`);
      }
      _.forEach(_.keys(item), (key) => {
        if (!_.some(names, (name) => (name === key))) {
          throw new Error(`[RabbitSchema] unsupported field "${key}" of item #${idx + 1} in schema array "${arr}"`);
        }
        const fieldTypes = typeof types[key] === 'string' ? [types[key]] : types[key];
        if (!_.some(fieldTypes, (type) => (typeof item[key] === type))) { // eslint-disable-line valid-typeof
          throw new Error(`[RabbitSchema] value of field "${key}" of item #${idx + 1} in schema array "${arr}" is of wrong type (expected: "${types[key]}", actual: "${typeof item[key]}")!`);
        }
      });
      _.forEach(names, (key) => {
        if (keys[key] && (item[key] === undefined)) {
          throw new Error(`[RabbitSchema] mandatory field "${key}" not found in item #${idx + 1} in schema array "${arr}"!`);
        }
      });
    });
  }
}
