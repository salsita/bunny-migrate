[![Dependency Status](https://img.shields.io/david/salsita/bunny-migrate.svg)](https://david-dm.org/salsita/bunny-migrate)
[![devDependency Status](https://img.shields.io/david/dev/salsita/bunny-migrate.svg)](https://david-dm.org/salsita/bunny-migrate?type=dev)
![Downloads](https://img.shields.io/npm/dm/bunny-migrate.svg?style=flat)
![Licence](https://img.shields.io/npm/l/bunny-migrate.svg?style=flat)
[![Known Vulnerabilities](https://snyk.io/test/github/salsita/bunny-migrate/badge.svg)](https://snyk.io/test/github/salsita/bunny-migrate)

# bunny-migrate

This is a command line tool that manages RabbitMQ schema instances.

## Goals

There are 3 main goals of the tool:
1. creating prefixed instances of given RabbitMQ schema (yes, prefixed, so that
you can create multiple instances of the same schema),
2. removing schema instances that are no longer used,
3. managing routing rules for existing schema instances.

To start with, you need a RabbitMQ schema definition file. It is a JSON file
that follows the format described below. You can use this tool to create an
instance of this schema, all names there will be prefixed with specified prefix.

Once new schema instance is added, you can specify routing rules for your
main entry exchange. We assume that at the beginning (or near the beginning) of
your processing pipeline, there is an exchange that routes the messages to
existing schema instances (e.g. according to `stable`, `next`, `latest` message
routing keys). That is useful for (beta-) testing and for draining messages
from existing schema instances when switching to newer processing pipelines with
zero down-time.

When you are done with existing processing pipeline (i.e. RabbitMQ schema
instance), and there are no managed routing rules defined for it, you can safely
remove it from Rabbit.

## Installation

```
$ npm i bunny-migrate
```

Installing this module adds a runnable file into your `node_modules/.bin` directory. If installed globally (with the
`-g` option), you can run `bunny-migrate`, otherwise you can run `./node_modules/.bin/bunny-migrate`.

## Commands

The tool supports the following commands; for detailed explanation see the sections below:
* `init`: inits the structures to keep run-info in RabbitMQ,
* `list`: lists managed schema instances and rules,
* `add`: adds new schema instance,
* `remove`: removes existing schema instance,
* `add-rule`: adds new managed rule,
* `remove-rule`: removes existing managed rule,
* `update-rule`: removes existing managed rule and adds a new one in turn,
* `version`: prints version and terminates,
* `help`: prints short help and terminates.

## Parameters

Parameter values are taken either from configuration file (either default one, which is `bunny-migrate.cfg` file
looked up in current working directory, or file explicitly provided with `--config` option from command line),
or they need to be provided on command line. If a parameter
is provided in both the config file and on the command line, the one from
command line is used. If any mandatory value (needed for given command) is
missing, the tool terminates. Mandatory and [optional] parameters for
each command are listed in respective sections below.

Information about added schema instances and associated routing rules are
stored in RabbitMQ instance itself. There is a special exchange / queue that
holds run-time information about the system.

## Format of configuration file

```
{
  // RabbitMQ instance to connect to
  "uri": "amqp://user:password@localhost:5672/vhost",

  // name of exchange / queue holding the run-time information
  "bunny-x": "bunny-migrate",

  // prefix of schema to be added / removed, or for which a managed rule is added / removed
  "prefix": "12345",

  // path to schema file
  "schema": "./schema.json",

  // whether or not to update managed rule when adding a new schema instance
  "update-rule": true,

  // name of the schema "entry-point" exchange when adding a managed rule
  "destination": "channel-router",

  // name of the exchange that serves as the source exchange of a managed rule
  "source": "prefix-router",

  // routing key of a managed rule
  "key": "latest",

  // optional arguments object when creating a managed rule
  "args": { }
}
```

Note: the comments in the above example must be stripped, they make the JSON invalid.

Even though you can specify all parameters in the configuration file like shown above,
it makes better sense to store there only the ones commonly used (`uri`, `bunny-x`,
and perhaps `source`), and provide the remaining parameters on the command line
when invoking the tool.

## Command line parameters

All of the above configuration file parameters can be provided on command line
as well. The names are the same, just prefixed with double dashes. The name of
the parameter on command line is then followed either with an equal sign or a space and then
with the value of the parameter (in case a string value is expected). For
boolean parameters: if you specify the parameter name, it is considered to have
`true` value, if it is missing, it is considered to have `false` value.

Example (string value): you can pass `uri` string on command line either as
`--uri="..."` or as `--uri "..."`.

Example (boolean value): the equivalent of configuration setting `"debug": true`
on command line is `--debug`.

The only exception to the above rules is `args` parameter, since it is of
object type in config file. To pass this value from command line, you need to
provide stringified equivalent of that object value. I.e. to pass equivalent of
```
  "args": {
    "test": true
  }
```
from configuration file, you need to provide on the command line
either `--args='{"test":true}'` or `--args '{"test":true}'`.

## Output and exit codes

There are 4 levels of output, all printed to standard output by default:
* debug
* info
* warning
* error

Info level is the default one, so without changing the output level, you will
see info, warning and error output messages.

To see the debug messages as well, you need to pass `--debug` or `-d` command
line parameter (or config file equivalent).

On the other hand, when passing `--quiet` or `-q` parameter, all output messages but
errors are suppressed.

In case both `--quiet` and `--debug` parameters are passed, `--debug` takes precedence.

The tool returns zero exit code upon success, non-zero exit code on errors. The
tools terminates its execution when running into the first unexpected problem.
To keep the RabbitMQ state as healthy and consistent, we check as much as possible
in advance to minimize the risk of something
going wrong (e.g. the tool verifies that none of the exchanges and queues exists
before it tries creating them, or that all of the exchanges and queues do exist
before removing them).

But sometimes, you know, life is tough and you have some leftovers in RabbitMQ.
For this case we have introduced the `--force` or `-f` command line option (or its config
file equivalent), that skips all the tests and the tool does not terminate when
running into unexpected issues. Warning: use with caution! There are still some
cases (e.g. RabbitMQ connection error) in which even the `--force` parameter will not
help you.

## Run-time initialization

When you have your RabbitMQ installed and want to start using this tool, you
need to create the exchange / queue that manages run-time information for this
tool inside the RabbitMQ instance.

```
$ bunny-migrate init
```

Parameters:
* `uri`
* `bunny-x`

The above command will connect to your RabbitMQ instance as specified using the
`uri` parameter, will create new `bunny-x` exchange and queue, and will store
run-time information for future usage there.

`bunny-x` exchange and queue must not exist prior to running this command (in
case either of them does, the tool terminates). Also, you should never manipulate
message in `bunny-x` queue by hand or other tools than `bunny-migrate`.

## Information about running system

```
$ bunny-migrate list
```

Parameters:
* `uri`
* `bunny-x`

This will give you information about all schema instances added, and all
routing rules managed by this tool. Note: this command will NOT give you information
about any other exchanges, queues, ... in your RabbitMQ instance, you need to
use other tools to get that.

## Schema definition file format

Schema definition file is a JSON file. The schema JSON has 4 root keys:
* `[exchanges]`: array of exchanges to create,
* `[queues]`: array of queues to create,
* `[queueBindings]`: array of queue-to-exchange bindings to define,
* `[exchangeBindings]`: array of exchange-to-exchange bindings to define,
* `[messages]`: array of messages to push into newly created exchanges and/or queues.

### Exchanges

Each exchange in the `exchanges` array of the schema JSON is described with an
object with following keys:
* `name`: the name of exchange to create,
* `type`: the type of exchange to create (`direct`, `fanout`, `topic`, or `headers`),
* `[options]`: object passed to `assertExchange()` if provided (see [docs](http://www.squaremobius.net/amqp.node/channel_api.html#channel_assertExchange)).

Each exchange name must be unique (can appear in the list of `exchanges` just once).

### Queues

Each queue in the `queues` array of the schema JSON is described with an object
with the following keys:
* `name`: the name of queue to create,
* `[options]`: object passed to `assertQueue()` if provided (see [docs](http://www.squaremobius.net/amqp.node/channel_api.html#channel_assertQueue)).

Each queue name must be unique (can appear in the list of `queues` just once).

### Queue-to-exchange bindings

Each queue-to-exchange binding from `queueBindings` array of the schema JSON asserts
a routing path from an exchange to a queue. The binding is described with an
object with the following keys:
* `queue`: the name of queue to which to route the messages,
* `exchange`: the name of exchange from which to route the messages,
* `pattern`: the routing pattern,
* `[args]`: an object containing extra arguments that may be required
for the particular exchange type (see [docs](http://www.squaremobius.net/amqp.node/channel_api.html#channel_bindQueue)).

You are allowed to bind only queues to exchanges that are defined as part of the
same schema file.

### Exchange-to-exchange bindings

Each exchange-to-exchange binding from `exchangeBindings` array of the schema JSON 
asserts a routing path from one exchange to another one based on provided pattern.
The binding is described with an object with the following keys:
* `destination`: the name of exchange where to route messages to,
* `source`: the name of exchange where to route messages from,
* `pattern`: the routing pattern,
* `[args]`: an object containing extra arguments that may be required for the particular exchange type.

You are allowed to bind only exchanges that are defined as part of the same schema file.

### Messages

Each message from `messages` array of the schema JSON describes a message (or multiple of messages) that will be pushed
to newly created exchange or queue. The message is described with an object with the following keys:
* `exchange` or `queue`: name of the exchange or the queue to push the message to (only one of them must be used),
* `key`: in case the message goes to an exchange, routing key must be specified,
* `content`: string or object that will be pushed as content of the message; if object is provided, it is converted to string,
* `[count]`: how many copies of the message to push to the exchange / the queue (default value: 1),
* `[options]`: additional options passed to the `publish()` or `sendToQueue()` methods (see the
[docs](http://www.squaremobius.net/amqp.node/channel_api.html#channel_publish) for more details).

You are allowed to push messages only to exchanges and/or queues that are defined as part of the same schema file.

## Creating new schema instance

```
$ bunny-migrate add
```

Parameters:
* `uri`
* `bunny-x`
* `schema`
* `prefix`
* `[update-rule]`

This will add new RabbitMQ schema instance, as described in `schema` JSON file.

All exchanges and queues will be prefixed with `prefix-string` and a dot (`.`).
For example: if there is a queue `tasks` described in the schema file, and the provided
prefix is `prefix`, then the name of the resulting queue created in RabbitMQ will be
`prefix.tasks`. If the prefix is empty string, the dot is NOT prepended.

Before any exchanges and queues are created, the tool checks (from run-time information
stored in Rabbit `<bunny-x>` queue) if provided `prefix` is not in use yet.

If the prefix can be used, an array of prefixed exchange and queue names is compiled and in turn
the tool verifies that none of the exchanges or queues with given names already exist in RabbitMQ.

Then the tool creates all the entities in the following order:
1. exchanges (as per `exchanges` schema array),
2. queues (as per `queues` schema array),
3. queue-to-exchange bindings (as per `queueBindings` schema array), and
4. exchange-to-exchange bindings (as per `exchangeBindings` schema array).

Whenever `options` or `args` object is to be passed, it is traversed (recursively) and all string values
that match name of exchange or queue (not prefixed) are replaced with string values of prefixed
equivalent.

Once all the entities are created and bound properly, the tool pushes messages to exchanges and/or to queues according to
the `messages` schema array. In this case the optional `options` object is NOT traversed and no prefixing of exchange /
queue names takes place, as none of the keys of the `options` object should reference an exchange or a queue.

After that the run-time information in `<bunny-x>` queue is updated with information about this schema instance.

If `update-rule` is set to `true`, the mandatory and optional parameters of the
command are extended with the ones for `update-rule` command (that is
effectively with parameters for `add-rule` command). If this parameter is
provided, the managed rule for provided routing key (e.g. with value `latest`)
is updated to point to the just-added schema instance. For more details see
the `update-rule` command below.

## Removing existing schema instance

```
$ bunny-migrate remove
```

Parameters:
* `uri`
* `bunny-x`
* `prefix`

This will remove existing RabbitMQ schema (i.e. queues and exchanges) for
specified prefix.

Before anything gets removed from RabbitMQ, the tool first checks if there is a
corresponding record for given prefix stored in its run-time information, and if
this prefix is NOT referenced from any of the managed rules (see below).

If all checks pass, the queues are removed first, then the exchanges.
All associated bindings are removed along with the entities.

## Adding a managed rule

```
$ bunny-migrate add-rule
```

Parameters:
* `uri`
* `bunny-x`
* `prefix`
* `destination`
* `source`
* `key`
* `[args]`

A managed rule is an exchange-to-exchange binding, specifying routing rule
between existing exchange `source` (that might or might not be created as part of
managed schema) and exchange `destination` (that must be part of a managed schema).
The name of `destination` exchange is provided unprefixed. 

Parameter `key` is used to for creating the routing pattern between the exchanges.
The value of `key` is taken and appended with a dot (`.`) and a hash-sign (`#`)
to form the routing pattern. E.g. from `key` value of `latest`, the routing pattern
`latest.#` is created. The original value of `key` must not contain dot (`.`),
space (` `), asterisk (`*`) and hash (`#`) characters.

First of all, the tool checks that:
* the routing `key` is not used in any of the existing managed rules,
* the `destination` exchange was created as part of `prefix` schema instance,
* the prefixed `destination` exchange is still present in RabbitMQ,
* the `source` exchange exists in RabbitMQ.

If all of above is met, the tool creates the expected binding and remembers it
in its run-time information.

Notes:
* Multiple routing `keys` can be used to bind to the same "entry-point"
exchange with the same `prefix`. After you add a new schema instance, you might
create single rule for `latest` routing `key`, but after testing you may
consider it stable and you can route the other traffic there under
different routing `key` (e.g. called `stable`). Then you can recycle the routing
`key` `latest` to a newer version of the schema (with another `prefix`) in the
future and use it again for initial testing.
* You might create the initial part of your RabbitMQ schema using this tool as
well. Use appropriate corresponding prefix, e.g. `main` or `master` for it
(or you can even use empty string). When referencing the
`source` exchange, you need to include that prefix into the name (as it should
be different prefix from what you are using to add the managed rule). So say you
created exchange `router` as part of schema instance `main`. So here, as
`destination` parameter, you need to pass name `main.router`.

## Removing existing managed rule

```
$ bunny-migrate remove-rule
```

Parameters:
* `uri`
* `bunny-x`
* `key`

This command removes the exchange-to-exchange binding created previously with
`add-rule` command for given routing `key`. It verifies that both (remembered)
exchanges (`source` and `prefix`ed `destination`) still exist, and if so, it
removes the binding for given routing `key`. It removes only this one binding,
other bindings (if there are any) are not affected.

## Updating existing managed rule

```
$ bunny-migrate update-rule
```

Parameters: see `add-rule` command.

This command (for given existing routing `key`) first removes existing managed
rule (if there is one) and adds another in turn based on provided parameters.

The result is equal to the sequence of `remove-rule` and `add-rule` commands for
the same routing `key`. The only difference is that in case there is no existing
rule for given routing `key` before envoking this command, the `update-rule`
command does not fail, but creates the new rule. In such case the `update-rule`
command is equivalent to `add-rule` command only.

## Examples

Let's say you have a web application that manages (big) data for its users, and the user can request some (bulk) data
updates in web interface. Let's say that the bulk update operation can take minutes or hours (e.g. there is some 3rd
party service involved, perhaps with some API rate limiter), so you decided to have dedicated workers processing these
updates. Each data bulk update can consist of hundreds or thousands of small operations, and you don't want to track them in
workers' memory (as if something bad happen to them, the progress is lost completely), nor in your main DB
(as you prefer subscribe / notify approach to constant DB polling). So you have RabbitMQ in place to store the operation 
progress there.

You have the DB with table with all information about the users, and all their data as well. Each user has a flag in the
DB table indicating if they are regular user, beta-test user, or even alpha-test user. The request for data bulk update
is pushed as a message from web-server to RabbitMQ exchange (let's call it `requests`). The message describes what user
requested what data bulk update, and workers (subscribed to RabbitMQ queue `requests`, where the exchange passes the
messages to) will take it from there. The end result is that the user's request for data bulk edit is processed and the
data is updated accordingly in the DB (and pushed to 3rd party services as well).

Now let's assume you have RabbitMQ installed on your production  machine `machine`, user `user` with password `password` created,
with access to the RabbitMQ vhost `vhost`. (Also, you have `bunny-migrate` tool installed. ;-))

First of all, since we'll be using only the above described RabbitMQ installation in our example,
let's create a config file with the following content:

```
{
  "uri": "amqp://user:password@machine:5672/vhost",
  "bunny-x": "bunny-admin"
}
```

The `uri` parameter is the RabbitMQ connection string, the second parameter is the name of exchange / queue to store the
run-time information of the `bunny-migrate` tool.

#### Init run-time

```
$ bunny-migrate init
```

This created `bunny-admin` exchange and queue where run-time information about the added schema instances and managed rules
will be stored.

#### Initial schema

At the beginning, we will need to create the exchange and queue for the messages pushed by web-server(s), we called them
`requests` in the example above. Also, we want to have our entry point to the processing world, this will be another
exchange that we'll call e.g. `main`.

There will be a worker process subscribed to `requests` queue that will take the message, check (in DB) for what type of
user the message is, and push the same message to `main` exchange with routing key corresponding to the user type (let's
say `regular`, `beta`, or `alpha`).

The initial schema file (stored in file `schema-initial.json`) will be something like this:

```
{
  "exchanges": [
    { "name": "requests", "type": "fanout" },
    { "name": "main", "type": "topic" }
  ],
  "queues": [
    { "name": "requests" }
  ],
  "queueBindings": [
    { "queue": "requests", "exchange": "requests", "pattern": "" }
  ]
}
```

To add the above queue and exchanges, run

```
$ bunny-migrate add --schema schema-initial.json --prefix ""
```

#### Data-processing schema

At this point, there is no queue bound to the `main` exchange. We said there would be a process pushing messages to
this exchange with routing keys `regular`, `beta`, or `alpha`, based on the user types.

So let's say we want to have `bulk-changes` exchange bound to the `main` exchange. Then there would be a worker process
reading messages from corresponding `bulk-changes` queue and figuring out what individual items are affected,
pushing one message per item to `items` exchange / queue.

From there we'll for example need to push modified items to 3rd party API, but it has a rate limiter on server
side, so we will get messages from the `items` queue and decide if we can push them to `api` exchange / queue
directly, or if they need to be delayed (using dead-letter-queue). (Btw. we have
[dripping-bucket](https://github.com/salsita/dripping-bucket) library for the API rate limiting with RabbitMQ, too!)

The worker getting messages from `api` queue performs the 3rd party communication and updates the DB based on the
response it gets from 3rd party service. Also, it returns API token back to `dripping-bucket` rate limiter by pushing a
message to `responses` exchange / queue (rate-limiter is subscribed to `items` queue as well as to `responses` queue).

Let's say that is your processing pipeline, and you constantly work on improvements and new versions and want to deploy
new versions to production with *zero downtime* and to move slowly users (first `alpha`, then `beta`, and finally
`regular` users) to newer versions.

The above example of schema can be coded as follows (and stored in `schema.json` file):

```
{
  "exchanges": [
    { "name": "bulk-changes", "type": "topic" },
    { "name": "items", "type": "topic" },
    { "name": "api", "type": "topic" },
    { "name": "api-wait", "type": "topic" },
    { "name": "responses", "type": "topic" }
  ],
  "queues": [
    { "name": "bulk-changes" },
    { "name": "items" },
    { "name": "api" },
    { "name": "api-wait", "options": { "arguments": { "x-dead-letter-exchange": "items" } } },
    { "name": "responses" }
  ],
  "queueBindings": [
    { "queue": "bulk-changes", "exchange": "bulk-changes", "pattern": "#" },
    { "queue": "items", "exchange": "items", "pattern": "#" },
    { "queue": "api", "exchange": "api", "pattern": "#" },
    { "queue": "api-wait", "exchange": "api-wait", "pattern": "#" },
    { "queue": "responses", "exchange": "responses", "pattern": "#" }
  ],
  "messages": [
    { "exchange": "bulk-changes", "key": "routing-key", "content": { "type": "via exchange" } },
    { "queue": "bulk-changes", "content": { "type": "direct push" }, "count": 7 }
  ]
}
```

Now you have a release with build number `1234` with all the message handlers ready. The handlers know the name of the
main entry exchange (i.e. `main`), and know the schema above they need to work with. Also, they know (e.g. through their
config file) that the build number is `1234` and that all exchanges and queues that are part of data-processing pipeline
will be prefixed with this build number in RabbitMQ.

Now you add your data-processing RabbitMQ pipeline, prefixed with the build number like this:

```
$ bunny-migrate add --schema schema.json --prefix 1234
```

You can verify what you have just added to RabbitMQ with 

```
$ bunny-migrate list
```

The `messages` section of the above schema illustrates how to populate queues with messages (with token messages, for
testing, ...). In our example we push one message to `bulk-changes` exchange with routing key `routing-key` and with
given content (payload). Taking into account the first binding defined in the `queueBindings` array (esp. routing
pattern `#`), this message ends up in the `bulk-changes` queue.

The second record in `messages` array demonstrates direct message push to specified queue (to `bulk-changes` queue
again). This time we added `count` option set to 7, so in the end you end up with 8 messages in total in that queue.

#### Managed rules

As you can see from the `list` command output above, the rules section is now still empty. I.e. there is no routing
defined from your `main` exchange into the starting exchange of your data-processing pipeline.

Since we installed just one instance of the schema for now, let's define rules that will route all
`regular`, `beta`, and `alpha` users to this schema instance:

```
$ bunny-migrate add-rule --prefix 1234 --source main --destination bulk-changes --key regular
```

We will be using source exchange `main` and destination exchange `bulk-changes` in the future as well, so no need to
specify that each time on the command line, let's extend our `bunny-migrate.cfg` file with these items, so the file now
becomes:

```
{
  "uri": "amqp://user:password@machine:5672/vhost",
  "bunny-x": "bunny-admin",
  "source": "main",
  "destination": "bulk-changes"
}
```

Adding routing rules for `beta` and `alpha` users is then easier:

```
$ bunny-migrate add-rule --prefix 1234 --key beta
$ bunny-migrate add-rule --prefix 1234 --key alpha
```

Now you can start all your workers and web-server(s) and everything will be routed / processed as expected, all user
traffic will be routed through the schema with prefix `1234` and processed by corresponding message handlers.

#### Deploying new releases with *zero downtime*

Later on you have a new release, `2345`, with updated message handlers and perhaps even the RabbitMQ schema (but still
the entry point to the data-processing part is the `bulk-changes` exchange).

You keep the existing infrastructure running as is (that is release `1234` and its workers / message handlers), as it
can take hours for all the messages there to be processed / drained.

So in parallel to release `1234` we can add RabbitMQ schema instance for release `2345`:

```
$ bunny-migrate add --schema schema.json --prefix 2345
```

Assuming you have also new worker(s) / message handlers deployed in parallel, you can start them now. Again, there is no
traffic routed to new pipeline `2345`, since all of it is still routed to previous pipeline `1234`.

You want to test with your `alpha` users first that the new pipeline is working fine, so let's route only `alpha`
users to the new pipeline:

```
$ bunny-migrate update-rule --prefix 2345 --key alpha
```

Later on you might route `beta` and `regular` users to new pipeline, too:

```
$ bunny-migrate update-rule --prefix 2345 --key beta
$ bunny-migrate update-rule --prefix 2345 --key regular
```

Then eventually (with some delay) all the messages in pipeline `1234` are processed / drained, so you don't need the
workers / message handlers associated to it (so can turn them off and possibly release the boxes), and also you can
remove the corresponding RabbitMQ schema instance:

```
$ bunny-migrate remove --prefix 1234
```

## Building from code

```
$ git clone git@github.com:salsita/bunny-migrate.git
$ cd bunny-migrate
$ npm i
$ npm run build
```

### `package.json` npm scripts

```
$ npm run build
```

Generate version file, lint the ES6 source code, transpile the ES6 source code into `dist` directory, and verify the
(transpiled) tests pass on the (transpiled) code.

```
$ npm run babel
```

Transpile (using babel with `.babelrc` configuration file) the ES6 source code
file into `dist` directory, that is referenced from binary `bin/bunny-migrate`.

```
$ npm run gen-ver
```
Generate `version.js` file exporting the current name and version of the tool, as taken from `package.json` itself.

```
$ npm run lint
```
Lint the (ES6) source code, using `.eslintrc.json` configuration file.


## Licence

MIT License

Copyright (c) 2017 -- 2019 Salsita Software

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
