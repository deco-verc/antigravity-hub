# bullmq_io - Knowledge Ready

Arquivo preparado para uso em GPT, Claude Project, Codex ou base de conhecimento.

## Indice

1. [Pagina 1](#pagina-1)
2. [Guide Introduction](#guide-introduction)
3. [Patterns Adding-Bulks](#patterns-adding-bulks)
4. [Python Introduction](#python-introduction)
5. [Rust Introduction](#rust-introduction)
6. [Elixir Introduction](#elixir-introduction)
7. [Php Introduction](#php-introduction)
8. [Bullmq-Pro Introduction](#bullmq-pro-introduction)
9. [Api Index Html](#api-index-html)
10. [Quick-Start](#quick-start)
11. [Changelog](#changelog)
12. [Changelogs Changelog-V5](#changelogs-changelog-v5)
13. [Changelogs Changelog-V4](#changelogs-changelog-v4)
14. [Changelogs Changelog-V3](#changelogs-changelog-v3)
15. [Changelogs Changelog-V2](#changelogs-changelog-v2)


---

## Pagina 1

Source URL: https://docs.bullmq.io/

# What is BullMQ [](https://docs.bullmq.io#what-is-bullmq)

BullMQ is a [Node.js](https://nodejs.org) library that implements a fast and robust queue system built on top of [Redis](https://redis.io) that helps in resolving many modern age micro-services architectures.

The library is designed so that it will fulfill the following goals:

- Exactly once queue semantics, i.e., attempts to deliver every message exactly one time, but it will deliver at least once in the worst case scenario*.
- Easy to scale horizontally. Add more workers for processing jobs in parallel.
- Consistent.
- High performant. Try to get the highest possible throughput from Redis by combining efficient .lua scripts and pipelining.

View the repository, see open issues, and contribute back [on GitHub](https://github.com/taskforcesh/bullmq)!

**Features** [](https://docs.bullmq.io#features)

If you are new to Message Queues, you may wonder why they are needed after all. Queues can solve many different problems in an elegant way, from smoothing out processing peaks to creating robust communication channels between micro-services or offloading heavy work from one server to many smaller workers, and many other use cases. Check the [Patterns](https://docs.bullmq.io/patterns/adding-bulks) section for getting some inspiration and information about best practices.

### Used by [](https://docs.bullmq.io#used-by)

BullMQ is used by many organizations big and small, here are some notable examples:


---

## Guide Introduction

Source URL: https://docs.bullmq.io/guide/introduction

# Introduction [](https://docs.bullmq.io#introduction)

BullMQ is based in 4 classes that together can be used to resolve many different problems. These classes are [Queue](https://docs.bullmq.io/api/classes/v6.Queue.html),

[,](https://docs.bullmq.io/api/classes/v6.Worker.html)

**Worker**[and](https://docs.bullmq.io/api/classes/v6.QueueEvents.html)

**QueueEvents**[.](https://docs.bullmq.io/api/classes/v6.FlowProducer.html)

**FlowProducer**The first class you should know about is the *Queue* class. This class represents a queue and can be used for adding * jobs* to the queue as well as some other basic manipulation such as pausing, cleaning or getting data from the queue.

Jobs in BullMQ are basically a user created data structure that can be stored in the queue. Jobs are processed by * workers*. A

*Worker*is the second class you should be aware about. Workers are instances capable of processing jobs. You can have many workers, either running in the same Node.js process, or in separate processes as well as in different machines. They will all consume jobs from the queue and mark the jobs as completed or failed.


---

## Patterns Adding-Bulks

Source URL: https://docs.bullmq.io/patterns/adding-bulks

# Adding jobs in bulk across different queues [](https://docs.bullmq.io#adding-jobs-in-bulk-across-different-queues)

Sometimes it is necessary to atomically add jobs to different queues in bulk. For example, there could be a requirement that all the jobs must be created or none of them. Also, adding jobs in bulk can be faster, since it reduces the number of roundtrips to Redis:

You may be think of [ queue.addBulk](https://docs.bullmq.io/api/classes/v6.Queue.html#addbulk), but this method only adds jobs to a single queue. Another option is

[, so let's see an example:](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#addbulk)

`flowProducer.addBulk`typescript

```
import { FlowProducer } from 'bullmq';
const flow = new FlowProducer({ connection });
const trees = await flow.addBulk([
{
name: 'job-1',
queueName: 'queueName-1',
data: {}
},
name: 'job-2',
queueName: 'queueName-2',
]);
```
It is possible to add individual jobs without children.

This call can only succeed or fail, and all or none of the jobs will be added.


---

## Python Introduction

Source URL: https://docs.bullmq.io/python/introduction

# Introduction [](https://docs.bullmq.io#introduction)

### Installation [](https://docs.bullmq.io#installation)

BullMQ is delivered as a pip package and can thus be installed using pip:

`$ pip install bullmq`### Get started [](https://docs.bullmq.io#get-started)

BullMQ uses [asyncio](https://docs.python.org/3/library/asyncio.html) in order to implement concurrency and provide efficient processing of jobs.

You can add jobs to a queue like this, assuming you have a Redis host running locally:

python

```
from bullmq import Queue
queue = Queue("myQueue")
# Add a job with data { "foo": "bar" } to the queue
await queue.add("myJob", { "foo": "bar" })
...
# Close when done adding jobs
await queue.close()
```
In order to consume the jobs from the queue you need to use the `Worker` class, providing a "processor" function that will consume the jobs. As soon as the worker is instantiated it will start consuming jobs:

```
from bullmq import Worker
import asyncio
import signal
async def process(job, job_token):
# job.data will include the data added to the queue
return doSomethingAsync(job)
async def main():
# Create an event that will be triggered for shutdown
shutdown_event = asyncio.Event()
def signal_handler(signal, frame):
print("Signal received, shutting down.")
shutdown_event.set()
# Assign signal handlers to SIGTERM and SIGINT
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)
# Feel free to remove the connection parameter, if your redis runs on localhost
worker = Worker("myQueue", process, {"connection": "rediss://<user>:<password>@<host>:<port>"})
# Wait until the shutdown event is set
await shutdown_event.wait()
# close the worker
print("Cleaning up worker...")
await worker.close()
print("Worker shut down successfully.")
if __name__ == "__main__":
asyncio.run(main())
```
WARNING

If Redis responses are in binary format, you should pass [decode_responses](https://redis.readthedocs.io/en/latest/examples/connection_examples.html#By-default-Redis-return-binary-responses,-to-decode-them-use-decode_responses=True) option as *True*.

## Redis Cluster [](https://docs.bullmq.io#redis-cluster)

Pass a `redis.asyncio.cluster.RedisCluster` client as the `connection`, and put a hash tag in the prefix so every key of a queue lands in one slot (see [Redis Cluster](https://docs.bullmq.io/patterns/redis-cluster)):

```
from bullmq import Queue, Worker
from redis.asyncio.cluster import RedisCluster
connection = RedisCluster(host="<host>", port=6379, decode_responses=True)
queue = Queue("myQueue", {"connection": connection, "prefix": "{myprefix}"})
worker = Worker("myQueue", process, {"connection": connection, "prefix": "{myprefix}"})
```


---

## Rust Introduction

Source URL: https://docs.bullmq.io/rust/introduction

# Introduction [](https://docs.bullmq.io#introduction)

## Installation [](https://docs.bullmq.io#installation)

Add BullMQ to your project via Cargo:

`cargo add bullmq-official --rename bullmq`Or add it to your `Cargo.toml`:

```
[dependencies]
bullmq = { version = "1.2", package = "bullmq-official" }
```
The crate is published as

`bullmq-official`(the`bullmq`,`bullmq-rust`and`bullmq-rs`names on crates.io are already taken by unrelated third-party crates), but it is imported in code as`bullmq`— e.g.`use bullmq::{Queue, Worker};`.

BullMQ for Rust requires:

- Rust 1.85+
- Tokio runtime
- Redis 6.2+

## Get Started [](https://docs.bullmq.io#get-started)

BullMQ uses [Tokio](https://tokio.rs) for async processing. All operations are non-blocking and designed for high-throughput concurrent workloads.

### Adding Jobs to a Queue [](https://docs.bullmq.io#adding-jobs-to-a-queue)

```
use bullmq::{Queue, QueueOptions};
#[tokio::main]
async fn main() -> bullmq::Result<()> {
let queue = Queue::new("my-queue", QueueOptions::default()).await?;
// Add a job with JSON data
queue.add("my-job", serde_json::json!({
"foo": "bar"
}), None).await?;
Ok(())
}
```
### Processing Jobs with a Worker [](https://docs.bullmq.io#processing-jobs-with-a-worker)

```
use bullmq::{Worker, WorkerOptions, Job};
use bullmq::worker::{ProcessorFn, CancellationToken};
use std::sync::Arc;
#[tokio::main]
let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
Box::pin(async move {
println!("Processing job: {} - {}", job.id(), job.name());
// Access job data
let data = job.data();
println!("Data: {}", data);
// Return a result value
Ok(serde_json::json!({"processed": true}))
})
});
let worker = Worker::new("my-queue", processor, WorkerOptions::default()).await?;
// Worker processes jobs automatically in the background.
// Wait for a signal or condition to shut down.
tokio::signal::ctrl_c().await.unwrap();
// Graceful shutdown with 5-second timeout
worker.close(5000).await?;
```
### Listening to Worker Events [](https://docs.bullmq.io#listening-to-worker-events)

```
#[tokio::main]
Ok(serde_json::json!(null))
// Consume events from the worker
while let Some(event) = worker.next_event().await {
match event {
bullmq::worker::WorkerEvent::Completed { job_id, result } => {
println!("Job {} completed with: {}", job_id, result);
bullmq::worker::WorkerEvent::Failed { job_id, error } => {
println!("Job {} failed: {}", job_id, error);
bullmq::worker::WorkerEvent::Active { job_id } => {
println!("Job {} started processing", job_id);
_ => {}
```
## Concurrency [](https://docs.bullmq.io#concurrency)

Configure how many jobs are processed simultaneously:

```
let worker = Worker::new("my-queue", processor, WorkerOptions {
concurrency: 10,
..Default::default()
}).await?;
```
The concurrency can be changed dynamically at runtime:

`worker.set_concurrency(20);`## Progress Tracking [](https://docs.bullmq.io#progress-tracking)

Report progress from inside the processor:

```
let processor: ProcessorFn = Arc::new(|mut job: Job, _token: CancellationToken| {
for i in 0..100 {
// Do work...
job.update_progress(bullmq::JobProgress::Number(i as f64)).await?;
```
## Job Retries with Backoff [](https://docs.bullmq.io#job-retries-with-backoff)

```
use bullmq::{Queue, QueueOptions, JobOptions};
use bullmq::types::BackoffStrategy;
queue.add("flaky-job", serde_json::json!({}), Some(JobOptions {
attempts: Some(5),
backoff: Some(BackoffStrategy::Exponential(1000)), // 1s, 2s, 4s, 8s, 16s
})).await?;
```
## Connection Configuration [](https://docs.bullmq.io#connection-configuration)

```
use bullmq::{QueueOptions, WorkerOptions};
use bullmq::options::RedisConnectionOptions;
let conn = RedisConnectionOptions {
url: "redis://user:password@redis.example.com:6380".to_string(),
};
let queue = Queue::new("my-queue", QueueOptions {
connection: conn.clone(),
connection: conn,
```
Instead of a URL you can use typed connection fields. When `host` is set, the URL is built from these fields (use `tls: true` for a `rediss://` TLS connection):

```
host: Some("redis.example.com".to_string()),
port: Some(6380),
username: Some("user".to_string()),
password: Some("password".to_string()),
db: Some(0),
tls: true,
```
### Custom TLS certificates [](https://docs.bullmq.io#custom-tls-certificates)

To connect over TLS with a custom root CA (for example a self-signed certificate) or a client certificate and key for mutual TLS (mTLS), provide a `tls_certs` value. All certificates and keys must be in PEM format. Setting `tls_certs` implies a TLS (`rediss://`) connection, so `tls: true` is not required:

```
use bullmq::options::{RedisConnectionOptions, TlsCerts};
tls_certs: Some(TlsCerts {
// Custom CA certificate (omit to use the default WebPKI root store).
root_cert: Some(std::fs::read("ca.pem")?),
// Client certificate and key for mutual TLS (mTLS).
client_cert: Some(std::fs::read("client-cert.pem")?),
client_key: Some(std::fs::read("client-key.pem")?),
}),
```
### Redis Cluster [](https://docs.bullmq.io#redis-cluster)

To connect to a Redis Cluster, set `cluster_nodes` to one or more seed node URLs; the rest of the topology is discovered automatically. In cluster mode `url`, `host`, `port` and `db` are ignored, while `username`, `password`, `tls` and `tls_certs` apply to every node.

BullMQ's Lua scripts access several keys of a queue at once, so all of them must live in the same hash slot. As with the Node.js and Python versions, use a [hash tag](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/#hash-tags) in the prefix (or in the queue name). Flows spanning several queues require the hash tag in the shared prefix:

```
use bullmq::{Queue, QueueOptions, Worker, WorkerOptions};
let conn = RedisConnectionOptions::new().cluster_nodes([
"redis://10.0.0.1:7000",
"redis://10.0.0.2:7000",
"redis://10.0.0.3:7000",
]);
let queue = Queue::with_options("my-queue", QueueOptions {
prefix: "{bull}".to_string(),
let worker = Worker::with_options("my-queue", processor, WorkerOptions {
```
Queues created this way are fully interoperable with Node.js and Python services that use the same prefix on the same cluster.

## Key Differences from Node.js [](https://docs.bullmq.io#key-differences-from-node-js)

| Aspect | Node.js | Rust |
|---|---|---|
| Runtime | Event loop (single-threaded) | Tokio (multi-threaded async) |
| Processor | `async function`or sandboxed file | `Arc<dyn Fn(Job, CancellationToken) -> Pin<Box<...>>>` |
| Events | EventEmitter pattern | `mpsc::UnboundedReceiver<WorkerEvent>` |
| Error handling | Exceptions | `Result<T, Error>`types |
| Cancellation | AbortSignal | `CancellationToken` |
| Concurrency | Cooperative (single core) | True parallelism across all CPU cores |

## Compatibility [](https://docs.bullmq.io#compatibility)

The Rust implementation uses the same Lua scripts and Redis data structures as the Node.js and Python versions. This means:

- Jobs added by Node.js workers can be processed by Rust workers (and vice versa)
- Queue state is fully shared across all language implementations
- You can mix languages in a single deployment


---

## Elixir Introduction

Source URL: https://docs.bullmq.io/elixir/introduction

# Introduction [](https://docs.bullmq.io#introduction)

BullMQ for Elixir is a robust, feature-rich message queue and job scheduling library built on top of Redis. It's a port of the popular [BullMQ](https://bullmq.io) library, providing full compatibility with existing BullMQ queues from Node.js, Python, and PHP.

## Features [](https://docs.bullmq.io#features)

- **High Performance**: Leverages Redis for fast, reliable message passing
- **Job Scheduling**: Schedule jobs to run at specific times or intervals
- **Priority Queues**: Process high-priority jobs first
- **Retry Strategies**: Automatic retries with configurable backoff
- **Rate Limiting**: Control job processing rates
- **Parent-Child Jobs**: Create complex job hierarchies with dependencies
- **Real-time Events**: Subscribe to job lifecycle events via Worker callbacks or QueueEvents
- **Concurrency Control**: Process multiple jobs simultaneously with true BEAM parallelism
- **Stalled Job Recovery**: Automatically recover jobs from crashed workers
- **Telemetry Integration**: Built-in observability with Telemetry
- **OTP Design**: Built using GenServers, Supervisors, and other OTP patterns
- **Cross-language Compatibility**: Share queues between Elixir, Node.js, Python, and PHP

## Installation [](https://docs.bullmq.io#installation)

Add BullMQ to your `mix.exs`:

elixir

```
def deps do
[
{:bullmq, "~> 0.1.0"},
{:redix, "~> 1.2"} # Redis client
]
end
```
Then run:

bash

`mix deps.get`## Quick Start [](https://docs.bullmq.io#quick-start)

### Setting Up Redis Connection [](https://docs.bullmq.io#setting-up-redis-connection)

Add a Redix connection to your supervision tree:

```
defmodule MyApp.Application do
use Application
def start(_type, _args) do
children = [
{Redix, name: :my_redis, host: "localhost", port: 6379}
Supervisor.start_link(children, strategy: :one_for_one)
```
### Adding Jobs [](https://docs.bullmq.io#adding-jobs)

```
# Add a job to a queue
{:ok, job} = BullMQ.Queue.add("emails", "send-welcome", %{
to: "user@example.com",
template: "welcome"
}, connection: :my_redis)
IO.puts("Created job: #{job.id}")
```
### Processing Jobs [](https://docs.bullmq.io#processing-jobs)

```
defmodule MyApp.EmailWorker do
def process(%BullMQ.Job{name: "send-welcome", data: data}) do
MyApp.Mailer.send_welcome(data["to"], data["template"])
{:ok, %{sent: true}}
# Start the worker
{:ok, worker} = BullMQ.Worker.start_link(
queue: "emails",
connection: :my_redis,
processor: &MyApp.EmailWorker.process/1,
concurrency: 5,
on_completed: fn job, result ->
Logger.info("Job #{job.id} completed")
)
```
## Architecture [](https://docs.bullmq.io#architecture)

BullMQ for Elixir leverages OTP patterns for reliability:

- **GenServer**for stateful components (Worker, QueueEvents)
- **Supervisor**for fault tolerance
- **Telemetry**for observability
- **True Parallelism**using multiple BEAM processes for concurrent job processing

## Documentation [](https://docs.bullmq.io#documentation)

For comprehensive documentation, see:

## Requirements [](https://docs.bullmq.io#requirements)

- Elixir 1.15 or later
- Erlang/OTP 26 or later
- Redis 6.0 or later (6.2+ recommended)


---

## Php Introduction

Source URL: https://docs.bullmq.io/php/introduction

# Introduction [](https://docs.bullmq.io#introduction)

The PHP package provides a **Queue client** that allows you to add jobs to BullMQ queues from your PHP applications. These jobs can then be processed by workers written in Node.js, Python, or Elixir.

INFO

The PHP package only implements the Queue class (producer side). Workers are not included as PHP's execution model is not well-suited for long-running worker processes. Use Node.js, Python, or Elixir workers to process the jobs.

### Installation [](https://docs.bullmq.io#installation)

#### Option 1: Download Release (Recommended) [](https://docs.bullmq.io#option-1-download-release-recommended)

Download the latest release from the [releases page](https://github.com/taskforcesh/bullmq/releases) (look for `bullmq-php-X.X.X.zip`), extract it to your project, and configure Composer:

```
{
"repositories": [
"type": "path",
"url": "./bullmq-php-X.X.X"
}
],
"require": {
"taskforcesh/bullmq-php": "*"
```
Then run:

`composer install`#### Option 2: Install from GitHub (Development) [](https://docs.bullmq.io#option-2-install-from-github-development)

For development or the latest changes, install directly from the repository:

```
"type": "vcs",
"url": "https://github.com/taskforcesh/bullmq"
"taskforcesh/bullmq-php": "dev-master"
},
"minimum-stability": "dev",
"prefer-stable": true
```
WARNING

Installing from VCS requires building the Lua scripts. After `composer install`, run from the monorepo root:

`yarn install && yarn build && yarn copy:lua:php`### Requirements [](https://docs.bullmq.io#requirements)

- PHP 8.1 or higher
- Redis 5.0 or higher (6.2+ recommended)
- Composer

### Get started [](https://docs.bullmq.io#get-started)

You can add jobs to a queue like this:

```
<?php
use BullMQ\Queue;
$queue = new Queue('myQueue');
// Add a job with data to the queue
$job = $queue->add('myJob', ['foo' => 'bar']);
echo "Added job with ID: " . $job->id . "\n";
// Close when done
$queue->close();
```
### Job Options [](https://docs.bullmq.io#job-options)

You can pass various options when adding jobs:

```
// Delayed job (delay in milliseconds)
$job = $queue->add('sendEmail', $emailData, [
'delay' => 60000, // Process after 60 seconds
]);
// Priority job (lower number = higher priority)
$job = $queue->add('urgent', $data, [
'priority' => 1,
// Job with custom ID
$job = $queue->add('processOrder', $orderData, [
'jobId' => 'order-' . $orderId,
// Job with retry settings
$job = $queue->add('flakyOperation', $data, [
'attempts' => 3,
'backoff' => [
'type' => 'exponential',
'delay' => 1000,
// LIFO (Last In, First Out) - process newest jobs first
$job = $queue->add('task', $data, [
'lifo' => true,
```
### Adding Multiple Jobs [](https://docs.bullmq.io#adding-multiple-jobs)

```
$jobs = $queue->addBulk([
['name' => 'email', 'data' => ['to' => 'user1@example.com']],
['name' => 'email', 'data' => ['to' => 'user2@example.com']],
['name' => 'email', 'data' => ['to' => 'user3@example.com']],
```
### Queue Management [](https://docs.bullmq.io#queue-management)

```
// Get job counts
$counts = $queue->getJobCounts();
echo "Waiting: " . $counts['waiting'] . "\n";
echo "Active: " . $counts['active'] . "\n";
// Get a specific job
$job = $queue->getJob('job-id');
// Pause/Resume the queue
$queue->pause();
$queue->resume();
// Clean old jobs
$cleaned = $queue->clean(3600000, 100, 'completed'); // 1 hour grace period
```
### Interoperability [](https://docs.bullmq.io#interoperability)

Jobs added with the PHP client are fully compatible with BullMQ workers in:

- **Node.js**- Using the official- [BullMQ](https://www.npmjs.com/package/bullmq)package
- **Python**- Using the- [BullMQ Python](https://pypi.org/project/bullmq/)package
- **Elixir**- Using the- [BullMQ Elixir](https://hex.pm/packages/bullmq)package

Example Node.js worker that processes jobs added from PHP:

```
import { Worker } from 'bullmq';
const worker = new Worker('myQueue', async job => {
console.log(`Processing job ${job.id} with data:`, job.data);
// Process the job...
return { success: true };
});
```
### Connection Options [](https://docs.bullmq.io#connection-options)

```
// Custom Redis connection
$queue = new Queue('myQueue', [
'connection' => [
'host' => 'redis.example.com',
'port' => 6379,
'password' => 'your-password',
// Using a Redis URI
'connection' => 'redis://user:password@localhost:6379/0',
// Custom prefix
'prefix' => 'myapp',
```
### Retry and Promote Jobs [](https://docs.bullmq.io#retry-and-promote-jobs)

```
// Retry all failed jobs
$queue->retryJobs([
'count' => 100, // Max jobs to retry per iteration (default: 1000)
'state' => 'failed', // State to retry from: 'failed' or 'completed'
// Promote all delayed jobs to waiting
$queue->promoteJobs(['count' => 100]);
// Get counts by priority
$counts = $queue->getCountsPerPriority([0, 1, 2, 3]);
```

**Note on Job Schedulers**: Repeatable/scheduled jobs (cron patterns) should be created from the Node.js side using `JobScheduler`. The PHP client is designed for adding individual jobs, not managing schedulers.

### More Information [](https://docs.bullmq.io#more-information)

For more details, see the [PHP README](https://github.com/taskforcesh/bullmq/tree/master/php) on GitHub.


---

## Bullmq-Pro Introduction

Source URL: https://docs.bullmq.io/bullmq-pro/introduction

# Introduction [](https://docs.bullmq.io#introduction)

BullMQ Pro, the commercial version of BullMQ, boasts advanced features and offers dedicated support from the library's authors. You can easily install this package as a drop-in replacement for the standard BullMQ to access these new features.

The BullMQ Pro version continues to evolve, with more features being added regularly. You can check the [roadmap](https://github.com/taskforcesh/bullmq-pro-support/projects/1) section to gain insight into what to expect in the forthcoming months.

### Commercial License [](https://docs.bullmq.io#commercial-license)

BullMQ Pro uses a per-organization licensing model, allowing unlimited use across all your projects. You can request a free trial token on [this page](https://taskforce.sh/account/bullmqpro), allowing you to evaluate its value. If you find it beneficial, consider subscribing under the '[Subscriptions](https://taskforce.sh/account/subscriptions)' tab.


---

## Api Index Html

Source URL: https://docs.bullmq.io/api/index.html

The fastest, most reliable, Redis-based distributed queue for Node.js, Python, Elixir, .NET, Rust, PHP, and more.

Carefully written for rock solid stability and atomicity.

[Follow Us](https://x.com/bullmqhq) for *important* Bull/BullMQ/BullMQ-Pro news and updates!

You can find tutorials and news in this blog: [https://blog.taskforce.sh/](https://blog.taskforce.sh/)

BullMQ is available natively in multiple languages:

`npm install bullmq`)`python/``pip install bullmq`)`rust/``cargo add bullmq-official --rename bullmq`)`elixir/``{:bullmq, "~> x.x"}`)`dotnet/``dotnet add package BullMQ`)`php/`For other platforms, check out the [BullMQ Proxy](https://github.com/taskforcesh/bullmq-proxy).

Supercharge your queues with a professional front end:

Sign up at [Taskforce.sh](https://taskforce.sh)

| [

](https://www.dragonflydb.io/) | Dragonfly is a new Redis™ drop-in replacement that is fully compatible with BullMQ and brings some important advantages over Redis™ such as massive
better performance by utilizing all CPU cores available and faster and more memory efficient data structures. Read more [here](https://www.dragonflydb.io/docs/integrations/bullmq)on how to use it with BullMQ. |

Some notable organizations using BullMQ:

| [

](https://github.com/microsoft/lage) | [

](https://github.com/vendure-ecommerce/vendure) | [

](https://github.com/datawrapper/datawrapper) | [

](https://github.com/nestjs/bull/tree/master/packages/bullmq) | [

](https://langfuse.com) |
| [

](https://github.com/teamcurri) | [

](https://novu.co) | [

](https://www.nocodb.com) | [

](https://infisical.com/) |

Install:

```
$ yarn add bullmq
```
If you use the node-redis adapter (`createNodeRedisClient`), install `redis` v5 or newer (`redis >= 5.0.0`).

If you use the Valkey Glide adapter (`createValkeyGlideClient`), install `@valkey/valkey-glide`.

Add jobs to the queue:

```
import { Queue } from 'bullmq';
const queue = new Queue('Paint');
queue.add('cars', { color: 'blue' });
```
Process the jobs in your workers:

```
import { Worker } from 'bullmq';
const worker = new Worker('Paint', async job => {
if (job.name === 'cars') {
await paintCar(job.data.color);
}
});
```
Listen to jobs for completion:

```
import { QueueEvents } from 'bullmq';
const queueEvents = new QueueEvents('Paint');
queueEvents.on('completed', ({ jobId }) => {
console.log('done painting');
queueEvents.on(
'failed',
({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
console.error('error painting', failedReason);
},
);
```
Adds jobs with parent-child relationship:

```
import { FlowProducer } from 'bullmq';
const flow = new FlowProducer();
const originalTree = await flow.add({
name: 'root-job',
queueName: 'topQueueName',
data: {},
children: [
{
name: 'child-job',
data: { idx: 0, foo: 'bar' },
queueName: 'childrenQueueName',
name: 'grandchild-job',
data: { idx: 1, foo: 'bah' },
queueName: 'grandChildrenQueueName',
data: { idx: 2, foo: 'baz' },
],
data: { idx: 3, foo: 'foo' },
```
This is just scratching the surface, check all the features and more in the official [documentation](https://docs.bullmq.io)

Since there are a few job queue solutions, here is a table comparing them:

| Feature | [BullMQ-Pro](https://bullmq.io/#bullmq-pro) | [BullMQ](https://bullmq.io) | Bull | Kue | Bee | Agenda |
|---|---|---|---|---|---|---|
| Backend | redis | redis | redis | redis | redis | mongo |
| Observables | ✓ | |||||
| Group Rate Limit | ✓ | |||||
| Group Support | ✓ | |||||
| Batches Support | ✓ | |||||
| Parent/Child Dependencies | ✓ | ✓ | ||||
| Deduplication (Debouncing) | ✓ | ✓ | ✓ | |||
| Deduplication (Throttling) | ✓ | ✓ | ✓ | |||
| Priorities | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Concurrency | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Delayed jobs | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Global events | ✓ | ✓ | ✓ | ✓ | ||
| Rate Limiter | ✓ | ✓ | ✓ | |||
| Pause/Resume | ✓ | ✓ | ✓ | ✓ | ||
| Sandboxed worker | ✓ | ✓ | ✓ | |||
| Repeatable jobs | ✓ | ✓ | ✓ | ✓ | ||
| Atomic ops | ✓ | ✓ | ✓ | ✓ | ||
| Persistence | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| UI | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Optimized for | Jobs / Messages | Jobs / Messages | Jobs / Messages | Jobs | Messages | Jobs |

Fork the repo, make some changes, submit a pull-request! Here is the [contributing](https://github.com/taskforcesh/bullmq/blob/master/contributing.md) doc that has more details.

Thanks for all the contributors that made this library possible, also a special mention to Leon van Kammen that kindly donated his npm bullmq repo.


---

## Quick-Start

Source URL: https://docs.bullmq.io/quick-start

# Quick Start [](https://docs.bullmq.io#quick-start)

## Install [](https://docs.bullmq.io#install)

Install using npm:

`$ npm install bullmq`Install using yarn:

`$ yarn add bullmq`INFO

BullMQ is written in TypeScript, and although it can be used in vanilla JavaScript, all examples in this guide will be written in TypeScript.

Import into your project and add some jobs:

```
import { Queue } from 'bullmq';
const myQueue = new Queue('foo');
async function addJobs() {
await myQueue.add('myJobName', { foo: 'bar' });
await myQueue.add('myJobName', { qux: 'baz' });
}
await addJobs();
```
DANGER

You need to have a Redis service running in your local computer to run these examples successfully. You can read more about Redis connections [here](https://docs.bullmq.io/guide/connections).

Jobs are added to the queue and can be processed at any time, with at least one Node.js process running a worker:

```
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
const connection = new IORedis({ maxRetriesPerRequest: null });
const worker = new Worker(
'foo',
async job => {
// Will print { foo: 'bar'} for the first job
// and { qux: 'baz' } for the second.
console.log(job.data);
},
{ connection },
);
```
INFO

You can have as many worker processes as you want, BullMQ will distribute the jobs across your workers in a round robin fashion.

You can listen to completed (or failed) jobs by attaching listeners to the workers:

```
worker.on('completed', job => {
console.log(`${job.id} has completed!`);
});
worker.on('failed', (job, err) => {
console.log(`${job.id} has failed with ${err.message}`);
```

There are many other events available, check the [Guide](https://docs.bullmq.io/guide/events/) or the [API reference](https://docs.bullmq.io/api/) for more information.

Sometimes you need to listen to all the workers events in a given place, for this you need to use a special class [ QueueEvents](https://docs.bullmq.io/api/classes/v6.QueueEvents.html):

```
import { QueueEvents } from 'bullmq';
const queueEvents = new QueueEvents('my-queue-name');
queueEvents.on('waiting', ({ jobId }) => {
console.log(`A job with ID ${jobId} is waiting`);
queueEvents.on('active', ({ jobId, prev }) => {
console.log(`Job ${jobId} is now active; previous status was ${prev}`);
queueEvents.on('completed', ({ jobId, returnvalue }) => {
console.log(`${jobId} has completed and returned ${returnvalue}`);
queueEvents.on('failed', ({ jobId, failedReason }) => {
console.log(`${jobId} has failed with reason ${failedReason}`);
```
You may also access the timestamp of the event, which looks like "1580456039332-0".

```
queueEvents.on('progress', ({ jobId, data }, timestamp) => {
console.log(`${jobId} reported progress ${data} at ${timestamp}`);
```

For performance reasons, the events emitted by a `QueueEvents` instance do not contain the `Job` instance, only the `jobId`. Use the [ Job.fromId](https://docs.bullmq.io/api/classes/v6.Job.html#fromid) method if you need the

`Job` instance.


---

## Changelog

Source URL: https://docs.bullmq.io/changelog

[6.4.2](https://github.com/taskforcesh/bullmq/compare/v6.4.1...v6.4.2) (2026-10-24) [](https://docs.bullmq.io#_6-4-2-2026-10-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes)

[6.4.1](https://github.com/taskforcesh/bullmq/compare/v6.4.0...v6.4.1) (2026-10-23) [](https://docs.bullmq.io#_6-4-1-2026-10-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-1)

[6.4.0](https://github.com/taskforcesh/bullmq/compare/v6.3.19...v6.4.0) (2026-10-21) [](https://docs.bullmq.io#_6-4-0-2026-10-21)

### Features [](https://docs.bullmq.io#features)

[6.3.19](https://github.com/taskforcesh/bullmq/compare/v6.3.18...v6.3.19) (2026-10-20) [](https://docs.bullmq.io#_6-3-19-2026-10-20)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements)

- **deduplication:**use LPOS for keepLastIfActive membership check (python)(elixir)(php)(rust) (- [#4956](https://github.com/taskforcesh/bullmq/issues/4956)) (- [8796b66](https://github.com/taskforcesh/bullmq/commit/8796b66653baa58b8ecf261d7d7595cc8b72e020)), closes- [#4613](https://github.com/taskforcesh/bullmq/issues/4613)

[6.3.18](https://github.com/taskforcesh/bullmq/compare/v6.3.17...v6.3.18) (2026-10-20) [](https://docs.bullmq.io#_6-3-18-2026-10-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-2)

[6.3.17](https://github.com/taskforcesh/bullmq/compare/v6.3.16...v6.3.17) (2026-10-18) [](https://docs.bullmq.io#_6-3-17-2026-10-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-3)

[6.3.16](https://github.com/taskforcesh/bullmq/compare/v6.3.15...v6.3.16) (2026-10-17) [](https://docs.bullmq.io#_6-3-16-2026-10-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-4)

[6.3.15](https://github.com/taskforcesh/bullmq/compare/v6.3.14...v6.3.15) (2026-10-14) [](https://docs.bullmq.io#_6-3-15-2026-10-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-5)

- **job:**respect priority when retrying a finished job (python) (elixir) (rust) (dotnet) (- [#4926](https://github.com/taskforcesh/bullmq/issues/4926)) (- [afc9711](https://github.com/taskforcesh/bullmq/commit/afc9711a89fe9e38547f09a79bce4566049266c0))

[6.3.14](https://github.com/taskforcesh/bullmq/compare/v6.3.13...v6.3.14) (2026-10-13) [](https://docs.bullmq.io#_6-3-14-2026-10-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-6)

[6.3.13](https://github.com/taskforcesh/bullmq/compare/v6.3.12...v6.3.13) (2026-10-12) [](https://docs.bullmq.io#_6-3-13-2026-10-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-7)

- **queue:**move children retried by retryJobs back to their parent's dependencies (- [#4879](https://github.com/taskforcesh/bullmq/issues/4879)) (python)(elixir)(php)(rust)(dotnet) (- [3d82850](https://github.com/taskforcesh/bullmq/commit/3d828501874eede00b997902068d301803b64c0f)), closes- [#4236](https://github.com/taskforcesh/bullmq/issues/4236)

[6.3.12](https://github.com/taskforcesh/bullmq/compare/v6.3.11...v6.3.12) (2026-10-09) [](https://docs.bullmq.io#_6-3-12-2026-10-09)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-8)

- **postgres:**inline SQL at build time to restore single-file bundler support (- [#4822](https://github.com/taskforcesh/bullmq/issues/4822)) (- [c6bc9a4](https://github.com/taskforcesh/bullmq/commit/c6bc9a4c869b3ea0d02ba4475b11de614bf3ecd7)), closes- [#4603](https://github.com/taskforcesh/bullmq/issues/4603)

[6.3.11](https://github.com/taskforcesh/bullmq/compare/v6.3.10...v6.3.11) (2026-10-01) [](https://docs.bullmq.io#_6-3-11-2026-10-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-9)

- **worker:**detach stalled checker from telemetry context to prevent trace leak (- [#4812](https://github.com/taskforcesh/bullmq/issues/4812)) fixes- [#4731](https://github.com/taskforcesh/bullmq/issues/4731)(- [01b8b14](https://github.com/taskforcesh/bullmq/commit/01b8b14a973984845dc0bbcefccf35b3ed30782d))

[6.3.10](https://github.com/taskforcesh/bullmq/compare/v6.3.9...v6.3.10) (2026-09-29) [](https://docs.bullmq.io#_6-3-10-2026-09-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-10)

[6.3.9](https://github.com/taskforcesh/bullmq/compare/v6.3.8...v6.3.9) (2026-09-25) [](https://docs.bullmq.io#_6-3-9-2026-09-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-11)

- **connection:**infer backend-specific connection options instead of hiding mismatches with casts (- [#4796](https://github.com/taskforcesh/bullmq/issues/4796)) (- [10dc93c](https://github.com/taskforcesh/bullmq/commit/10dc93c59790cfffb117624311ca3983172955a8))

[6.3.8](https://github.com/taskforcesh/bullmq/compare/v6.3.7...v6.3.8) (2026-09-18) [](https://docs.bullmq.io#_6-3-8-2026-09-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-12)

[6.3.7](https://github.com/taskforcesh/bullmq/compare/v6.3.6...v6.3.7) (2026-09-18) [](https://docs.bullmq.io#_6-3-7-2026-09-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-13)

- **deduplication:**remove deduplication key if job key does not longer exist (python) (elixir) (php) (rust) (dotnet) (- [#4768](https://github.com/taskforcesh/bullmq/issues/4768)) (- [75bb3a0](https://github.com/taskforcesh/bullmq/commit/75bb3a059ff214b419553822d41d3e8eaff7e888))

[6.3.6](https://github.com/taskforcesh/bullmq/compare/v6.3.5...v6.3.6) (2026-09-14) [](https://docs.bullmq.io#_6-3-6-2026-09-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-14)

[6.3.5](https://github.com/taskforcesh/bullmq/compare/v6.3.4...v6.3.5) (2026-09-14) [](https://docs.bullmq.io#_6-3-5-2026-09-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-15)

[6.3.4](https://github.com/taskforcesh/bullmq/compare/v6.3.3...v6.3.4) (2026-09-01) [](https://docs.bullmq.io#_6-3-4-2026-09-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-16)

- Nothing changed, triggered by a Rust version release

[6.3.3](https://github.com/taskforcesh/bullmq/compare/v6.3.2...v6.3.3) (2026-08-31) [](https://docs.bullmq.io#_6-3-3-2026-08-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-17)

- **bun:**duplicate() and reconnect target the correct server (- [#4591](https://github.com/taskforcesh/bullmq/issues/4591)) (- [e9b5679](https://github.com/taskforcesh/bullmq/commit/e9b5679864e428c9791ed18901d3dc50bf401e84))
- **worker:**keep blocking client alive when parked in reconnecting (- [#4586](https://github.com/taskforcesh/bullmq/issues/4586)) (- [8fd4850](https://github.com/taskforcesh/bullmq/commit/8fd48506030d83841a0cacf993ff85c7e56ab7de))

[6.3.2](https://github.com/taskforcesh/bullmq/compare/v6.3.1...v6.3.2) (2026-08-29) [](https://docs.bullmq.io#_6-3-2-2026-08-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-18)

- **deps:**upgrade msgpackr to 2.1.0 and uuid to 1.26.0 (rust) (- [#4621](https://github.com/taskforcesh/bullmq/issues/4621)) (- [74987e9](https://github.com/taskforcesh/bullmq/commit/74987e914f22e7647662406861e2ad3101b883d4))
- **worker:**delegate maximumBlockTimeout to the backend (python) (- [#4644](https://github.com/taskforcesh/bullmq/issues/4644)) (- [ea4543c](https://github.com/taskforcesh/bullmq/commit/ea4543cc78aa11935ed5e9af7d4b47fd3e23aea0))

[6.3.1](https://github.com/taskforcesh/bullmq/compare/v6.3.0...v6.3.1) (2026-08-27) [](https://docs.bullmq.io#_6-3-1-2026-08-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-19)

- Nothing changed, triggered by a elixir version release

[6.3.0](https://github.com/taskforcesh/bullmq/compare/v6.2.2...v6.3.0) (2026-08-26) [](https://docs.bullmq.io#_6-3-0-2026-08-26)

### Features [](https://docs.bullmq.io#features-1)

[6.2.2](https://github.com/taskforcesh/bullmq/compare/v6.2.1...v6.2.2) (2026-08-25) [](https://docs.bullmq.io#_6-2-2-2026-08-25)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-1)

- **queue:**do not affect rate limit when processing deferred failures (python) (elixir) (rust) (dotnet) (- [#4607](https://github.com/taskforcesh/bullmq/issues/4607)) (- [ec4be04](https://github.com/taskforcesh/bullmq/commit/ec4be04c04725f5e341920ddef98adf7874a41d5))

[6.2.1](https://github.com/taskforcesh/bullmq/compare/v6.2.0...v6.2.1) (2026-08-25) [](https://docs.bullmq.io#_6-2-1-2026-08-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-20)

- Nothing changed, triggered by a elixir version release

[6.2.0](https://github.com/taskforcesh/bullmq/compare/v6.1.2...v6.2.0) (2026-08-21) [](https://docs.bullmq.io#_6-2-0-2026-08-21)

### Features [](https://docs.bullmq.io#features-2)

[6.1.2](https://github.com/taskforcesh/bullmq/compare/v6.1.1...v6.1.2) (2026-08-16) [](https://docs.bullmq.io#_6-1-2-2026-08-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-21)

[6.1.1](https://github.com/taskforcesh/bullmq/compare/v6.1.0...v6.1.1) (2026-08-14) [](https://docs.bullmq.io#_6-1-1-2026-08-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-22)

[6.1.0](https://github.com/taskforcesh/bullmq/compare/v6.0.11...v6.1.0) (2026-08-12) [](https://docs.bullmq.io#_6-1-0-2026-08-12)

### Features [](https://docs.bullmq.io#features-3)

[6.0.11](https://github.com/taskforcesh/bullmq/compare/v6.0.10...v6.0.11) (2026-08-10) [](https://docs.bullmq.io#_6-0-11-2026-08-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-23)

[6.0.10](https://github.com/taskforcesh/bullmq/compare/v6.0.9...v6.0.10) (2026-08-10) [](https://docs.bullmq.io#_6-0-10-2026-08-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-24)

[6.0.9](https://github.com/taskforcesh/bullmq/compare/v6.0.8...v6.0.9) (2026-08-07) [](https://docs.bullmq.io#_6-0-9-2026-08-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-25)

[6.0.8](https://github.com/taskforcesh/bullmq/compare/v6.0.7...v6.0.8) (2026-08-05) [](https://docs.bullmq.io#_6-0-8-2026-08-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-26)

- **deps:**avoid deep ioredis import so postgres backend works without ioredis internals (- [#4437](https://github.com/taskforcesh/bullmq/issues/4437)) fixes- [#4435](https://github.com/taskforcesh/bullmq/issues/4435)(- [550e446](https://github.com/taskforcesh/bullmq/commit/550e446db235be4bb9ee15d4d882632e139b3afb))
- **postgres:**fail fast when SQL loader directory cannot be resolved (- [#4482](https://github.com/taskforcesh/bullmq/issues/4482)) (- [f3936a2](https://github.com/taskforcesh/bullmq/commit/f3936a22fe564ddf3468ee8388e7024ad9a76265))

[6.0.7](https://github.com/taskforcesh/bullmq/compare/v6.0.6...v6.0.7) (2026-08-04) [](https://docs.bullmq.io#_6-0-7-2026-08-04)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-27)

[6.0.6](https://github.com/taskforcesh/bullmq/compare/v6.0.5...v6.0.6) (2026-08-03) [](https://docs.bullmq.io#_6-0-6-2026-08-03)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-28)

[6.0.5](https://github.com/taskforcesh/bullmq/compare/v6.0.4...v6.0.5) (2026-08-01) [](https://docs.bullmq.io#_6-0-5-2026-08-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-29)

- No Node.js changes.

[6.0.4](https://github.com/taskforcesh/bullmq/compare/v6.0.3...v6.0.4) (2026-08-01) [](https://docs.bullmq.io#_6-0-4-2026-08-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-30)

[6.0.3](https://github.com/taskforcesh/bullmq/compare/v6.0.2...v6.0.3) (2026-07-31) [](https://docs.bullmq.io#_6-0-3-2026-07-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-31)

[6.0.2](https://github.com/taskforcesh/bullmq/compare/v6.0.1...v6.0.2) (2026-07-31) [](https://docs.bullmq.io#_6-0-2-2026-07-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-32)

- No Node.js changes.

[6.0.1](https://github.com/taskforcesh/bullmq/compare/v6.0.0...v6.0.1) (2026-07-31) [](https://docs.bullmq.io#_6-0-1-2026-07-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-33)

- No Node.js changes.

[6.0.0](https://github.com/taskforcesh/bullmq/compare/v5.81.3...v6.0.0) (2026-07-30) [](https://docs.bullmq.io#_6-0-0-2026-07-30)

### Features [](https://docs.bullmq.io#features-4)

- release BullMQ v6 with pluggable queue backends (php) (python) (elixir) ([e1f86ef](https://github.com/taskforcesh/bullmq/commit/e1f86effc5bddda5b70d890866d9a490555e41ff))
- Introduce the IQueueBackend abstraction, Redis and PostgreSQL backends, and the accompanying v6 updates across the supported language clients.

### BREAKING CHANGES [](https://docs.bullmq.io#breaking-changes)

- High-level classes no longer expose Redis internals. The optional Connection constructor parameter is replaced by an optional BackendFactory. Queue#client, Queue#redisVersion, Queue#databaseType, Worker#blockingClient, and FlowProducer#client are removed. Access the raw Redis client through the RedisQueueBackend returned by getBackend(). Worker#waitUntilReady() now resolves to void instead of the Redis client.
- Legacy repeatable jobs and their APIs are removed. This includes the repeat option on Queue#add and Queue#addBulk, the Repeat class, Queue#getRepeatableJobs(), Queue#removeRepeatable(), and Queue#removeRepeatableByKey(). Migrate recurring jobs to Job Schedulers.
- The minimum supported Node.js version is now 14.17.0.
- Worker#resume() is now asynchronous, returns `Promise<void>`, and must be awaited.
- Queue#clean() telemetry now reports the number of cleaned jobs instead of recording the complete array of job IDs.
- The deprecated TelemetryAttributes JobFinishedTimestamp and TelemetryAttributes.JobStatus members are removed. Telemetry uses JobState, and workers no longer set JobFinishedTimestamp on spans.
- Meter#createGauge() is now required for telemetry adapters.
- The deprecated debounce option and Job#debounceId property are removed. Use deduplication and Job#deduplicationId instead.
- The deprecated debounced event is removed. Listen for the deduplicated event instead.
- FlowJob now distinguishes parent and leaf nodes. Deduplication is no longer allowed on parent flow nodes.
- Job#discard() is removed from the Node.js API. Use UnrecoverableError instead.
- The legacy nextSchedulerJobId property is removed from Job and JobJson.
- ioredis is no longer installed as a direct dependency and is now an optional peer dependency. Redis users must install ioredis explicitly.
- The paused job state is removed from JobType and from the default Queue#getJobCounts() result. Jobs in a paused queue are represented as waiting.
- RepeatOptions no longer accepts the cron-parser currentDate, utc, or nthDayOfWeek options. Use tz: 'UTC' instead of utc: true.
- The public Redis implementation exports Scripts, createScripts, JobJsonRaw, and RedisJobOptions are removed. Use the backend APIs instead.


---

## Changelogs Changelog-V5

Source URL: https://docs.bullmq.io/changelogs/changelog-v5

[5.81.4](https://github.com/taskforcesh/bullmq/compare/v5.81.3...v5.81.4) (2026-08-27) [](https://docs.bullmq.io#_5-81-4-2026-08-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes)

[5.81.3](https://github.com/taskforcesh/bullmq/compare/v5.81.2...v5.81.3) (2026-07-30) [](https://docs.bullmq.io#_5-81-3-2026-07-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-1)

- **deps:**update dependency msgpackr to v2.0.5 [security] (- [#4387](https://github.com/taskforcesh/bullmq/issues/4387)) (- [6fccb59](https://github.com/taskforcesh/bullmq/commit/6fccb59248c3d78e81ae09ad70b8cbea7ae48b87))
- **worker:**recover blocking client after sentinel disconnect, fixes (- [#4384](https://github.com/taskforcesh/bullmq/issues/4384)) (- [93649b8](https://github.com/taskforcesh/bullmq/commit/93649b8694a155a7c6fcd596f772e43b86285f1f))

[5.81.2](https://github.com/taskforcesh/bullmq/compare/v5.81.1...v5.81.2) (2026-07-24) [](https://docs.bullmq.io#_5-81-2-2026-07-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-2)

- prevent unhandled rejection when a connection's init fails before an 'error' listener is attached ([#4328](https://github.com/taskforcesh/bullmq/issues/4328)) ([315ec33](https://github.com/taskforcesh/bullmq/commit/315ec3309a42ccf898b2b825e39c42292b7932e7))
- **telemetry:**emit job.state while preserving job.status compatibility (- [#4293](https://github.com/taskforcesh/bullmq/issues/4293)) (- [36a3b2a](https://github.com/taskforcesh/bullmq/commit/36a3b2a4196b4611db89b1640a6315e26de37eb0))

[5.81.1](https://github.com/taskforcesh/bullmq/compare/v5.81.0...v5.81.1) (2026-07-24) [](https://docs.bullmq.io#_5-81-1-2026-07-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-3)

- **queue:**retrieve jobs in same transaction under getJobs (- [#4300](https://github.com/taskforcesh/bullmq/issues/4300)) (python) (elixir) (php) (rust) (- [8571503](https://github.com/taskforcesh/bullmq/commit/8571503034a43c6d5882e290051957215fd20fee))

[5.81.0](https://github.com/taskforcesh/bullmq/compare/v5.80.12...v5.81.0) (2026-07-23) [](https://docs.bullmq.io#_5-81-0-2026-07-23)

### Features [](https://docs.bullmq.io#features)

[5.80.12](https://github.com/taskforcesh/bullmq/compare/v5.80.11...v5.80.12) (2026-07-23) [](https://docs.bullmq.io#_5-80-12-2026-07-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-4)

- **bun:**match Bun RedisClient callback types and suppress teardown ConnectionClosedError (- [#4329](https://github.com/taskforcesh/bullmq/issues/4329)) fixes- [#4212](https://github.com/taskforcesh/bullmq/issues/4212)(- [c7bd217](https://github.com/taskforcesh/bullmq/commit/c7bd217ab0496fbdcbacd486b85cca8a825aa4d4))

[5.80.11](https://github.com/taskforcesh/bullmq/compare/v5.80.10...v5.80.11) (2026-07-23) [](https://docs.bullmq.io#_5-80-11-2026-07-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-5)

[5.80.10](https://github.com/taskforcesh/bullmq/compare/v5.80.9...v5.80.10) (2026-07-21) [](https://docs.bullmq.io#_5-80-10-2026-07-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-6)

- Nothing changed, triggered by a ci OSV change

[5.80.9](https://github.com/taskforcesh/bullmq/compare/v5.80.8...v5.80.9) (2026-07-18) [](https://docs.bullmq.io#_5-80-9-2026-07-18)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements)

[5.80.8](https://github.com/taskforcesh/bullmq/compare/v5.80.7...v5.80.8) (2026-07-18) [](https://docs.bullmq.io#_5-80-8-2026-07-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-7)

[5.80.7](https://github.com/taskforcesh/bullmq/compare/v5.80.6...v5.80.7) (2026-07-17) [](https://docs.bullmq.io#_5-80-7-2026-07-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-8)

[5.80.6](https://github.com/taskforcesh/bullmq/compare/v5.80.5...v5.80.6) (2026-07-17) [](https://docs.bullmq.io#_5-80-6-2026-07-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-9)

[5.80.5](https://github.com/taskforcesh/bullmq/compare/v5.80.4...v5.80.5) (2026-07-16) [](https://docs.bullmq.io#_5-80-5-2026-07-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-10)

[5.80.4](https://github.com/taskforcesh/bullmq/compare/v5.80.3...v5.80.4) (2026-07-15) [](https://docs.bullmq.io#_5-80-4-2026-07-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-11)

[5.80.3](https://github.com/taskforcesh/bullmq/compare/v5.80.2...v5.80.3) (2026-07-15) [](https://docs.bullmq.io#_5-80-3-2026-07-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-12)

[5.80.2](https://github.com/taskforcesh/bullmq/compare/v5.80.1...v5.80.2) (2026-07-11) [](https://docs.bullmq.io#_5-80-2-2026-07-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-13)

[5.80.1](https://github.com/taskforcesh/bullmq/compare/v5.80.0...v5.80.1) (2026-07-10) [](https://docs.bullmq.io#_5-80-1-2026-07-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-14)

[5.80.0](https://github.com/taskforcesh/bullmq/compare/v5.79.4...v5.80.0) (2026-07-10) [](https://docs.bullmq.io#_5-80-0-2026-07-10)

- Nothing changed, triggered by a rust version release

[5.79.4](https://github.com/taskforcesh/bullmq/compare/v5.79.3...v5.79.4) (2026-07-10) [](https://docs.bullmq.io#_5-79-4-2026-07-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-15)

[5.79.3](https://github.com/taskforcesh/bullmq/compare/v5.79.2...v5.79.3) (2026-07-07) [](https://docs.bullmq.io#_5-79-3-2026-07-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-16)

[5.79.2](https://github.com/taskforcesh/bullmq/compare/v5.79.1...v5.79.2) (2026-06-27) [](https://docs.bullmq.io#_5-79-2-2026-06-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-17)

- **flow:**use correct data structure when retrying failed child using ignoreDependencyOnFailure fixes- [#4235](https://github.com/taskforcesh/bullmq/issues/4235)(- [#4236](https://github.com/taskforcesh/bullmq/issues/4236)) (- [6f1b2e3](https://github.com/taskforcesh/bullmq/commit/6f1b2e33b01c9f97dee6ff96bab782a8399c7ae5))

[5.79.1](https://github.com/taskforcesh/bullmq/compare/v5.79.0...v5.79.1) (2026-06-21) [](https://docs.bullmq.io#_5-79-1-2026-06-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-18)

[5.79.0](https://github.com/taskforcesh/bullmq/compare/v5.78.1...v5.79.0) (2026-06-18) [](https://docs.bullmq.io#_5-79-0-2026-06-18)

### Features [](https://docs.bullmq.io#features-1)

- Nothing changed, triggered by a rust version release

[5.78.1](https://github.com/taskforcesh/bullmq/compare/v5.78.0...v5.78.1) (2026-06-13) [](https://docs.bullmq.io#_5-78-1-2026-06-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-19)

[5.78.0](https://github.com/taskforcesh/bullmq/compare/v5.77.7...v5.78.0) (2026-06-02) [](https://docs.bullmq.io#_5-78-0-2026-06-02)

### Features [](https://docs.bullmq.io#features-2)

- Nothing changed, triggered by a rust version release

[5.77.7](https://github.com/taskforcesh/bullmq/compare/v5.77.6...v5.77.7) (2026-06-01) [](https://docs.bullmq.io#_5-77-7-2026-06-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-20)

[5.77.6](https://github.com/taskforcesh/bullmq/compare/v5.77.5...v5.77.6) (2026-05-27) [](https://docs.bullmq.io#_5-77-6-2026-05-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-21)

[5.77.5](https://github.com/taskforcesh/bullmq/compare/v5.77.4...v5.77.5) (2026-05-27) [](https://docs.bullmq.io#_5-77-5-2026-05-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-22)

[5.77.4](https://github.com/taskforcesh/bullmq/compare/v5.77.3...v5.77.4) (2026-05-26) [](https://docs.bullmq.io#_5-77-4-2026-05-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-23)

- **deduplication:**preserve custom jobId when requeuing keepLastIfActive proto-jobs (- [#4190](https://github.com/taskforcesh/bullmq/issues/4190)) fixes- [#4030](https://github.com/taskforcesh/bullmq/issues/4030)(- [6e4972e](https://github.com/taskforcesh/bullmq/commit/6e4972e8fd721035d680ca291049134c3876f8ba))

[5.77.3](https://github.com/taskforcesh/bullmq/compare/v5.77.2...v5.77.3) (2026-05-25) [](https://docs.bullmq.io#_5-77-3-2026-05-25)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-1)

[5.77.2](https://github.com/taskforcesh/bullmq/compare/v5.77.1...v5.77.2) (2026-05-24) [](https://docs.bullmq.io#_5-77-2-2026-05-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-24)

- **connection:**use more permissive typing on NodeRedisRawClient options (- [#4184](https://github.com/taskforcesh/bullmq/issues/4184)) (- [#4187](https://github.com/taskforcesh/bullmq/issues/4187)) (- [0feec14](https://github.com/taskforcesh/bullmq/commit/0feec14452865c419961edb9c733f9951b6a663f)), closes- [#4170](https://github.com/taskforcesh/bullmq/issues/4170)

[5.77.1](https://github.com/taskforcesh/bullmq/compare/v5.77.0...v5.77.1) (2026-05-23) [](https://docs.bullmq.io#_5-77-1-2026-05-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-25)

[5.77.0](https://github.com/taskforcesh/bullmq/compare/v5.76.11...v5.77.0) (2026-05-21) [](https://docs.bullmq.io#_5-77-0-2026-05-21)

### Features [](https://docs.bullmq.io#features-3)

[5.76.11](https://github.com/taskforcesh/bullmq/compare/v5.76.10...v5.76.11) (2026-05-21) [](https://docs.bullmq.io#_5-76-11-2026-05-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-26)

[5.76.10](https://github.com/taskforcesh/bullmq/compare/v5.76.9...v5.76.10) (2026-05-17) [](https://docs.bullmq.io#_5-76-10-2026-05-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-27)

- **flow:**respect parent attribute deletion from child when calling removeChildDependency (- [#4169](https://github.com/taskforcesh/bullmq/issues/4169)) (- [6396b4e](https://github.com/taskforcesh/bullmq/commit/6396b4e2a146d733d01d8d9629cc8c8ffb8fac2d))

[5.76.9](https://github.com/taskforcesh/bullmq/compare/v5.76.8...v5.76.9) (2026-05-16) [](https://docs.bullmq.io#_5-76-9-2026-05-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-28)

[5.76.8](https://github.com/taskforcesh/bullmq/compare/v5.76.7...v5.76.8) (2026-05-12) [](https://docs.bullmq.io#_5-76-8-2026-05-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-29)

[5.76.7](https://github.com/taskforcesh/bullmq/compare/v5.76.6...v5.76.7) (2026-05-11) [](https://docs.bullmq.io#_5-76-7-2026-05-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-30)

[5.76.6](https://github.com/taskforcesh/bullmq/compare/v5.76.5...v5.76.6) (2026-05-06) [](https://docs.bullmq.io#_5-76-6-2026-05-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-31)

[5.76.5](https://github.com/taskforcesh/bullmq/compare/v5.76.4...v5.76.5) (2026-05-02) [](https://docs.bullmq.io#_5-76-5-2026-05-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-32)

[5.76.4](https://github.com/taskforcesh/bullmq/compare/v5.76.3...v5.76.4) (2026-04-29) [](https://docs.bullmq.io#_5-76-4-2026-04-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-33)

[5.76.3](https://github.com/taskforcesh/bullmq/compare/v5.76.2...v5.76.3) (2026-04-28) [](https://docs.bullmq.io#_5-76-3-2026-04-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-34)

- **metrics:**add total counters to Prometheus export for accurate counts with auto-removal (- [#3967](https://github.com/taskforcesh/bullmq/issues/3967)) (- [0bf1b4d](https://github.com/taskforcesh/bullmq/commit/0bf1b4d38475b320c89947b9779ec7301ec10117))

[5.76.2](https://github.com/taskforcesh/bullmq/compare/v5.76.1...v5.76.2) (2026-04-25) [](https://docs.bullmq.io#_5-76-2-2026-04-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-35)

[5.76.1](https://github.com/taskforcesh/bullmq/compare/v5.76.0...v5.76.1) (2026-04-22) [](https://docs.bullmq.io#_5-76-1-2026-04-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-36)

[5.76.0](https://github.com/taskforcesh/bullmq/compare/v5.75.2...v5.76.0) (2026-04-22) [](https://docs.bullmq.io#_5-76-0-2026-04-22)

### Features [](https://docs.bullmq.io#features-4)

- Nothing changed, triggered by a python version release

[5.75.2](https://github.com/taskforcesh/bullmq/compare/v5.75.1...v5.75.2) (2026-04-20) [](https://docs.bullmq.io#_5-75-2-2026-04-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-37)

[5.75.1](https://github.com/taskforcesh/bullmq/compare/v5.75.0...v5.75.1) (2026-04-20) [](https://docs.bullmq.io#_5-75-1-2026-04-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-38)

- Nothing changed, triggered by a python version release

[5.75.0](https://github.com/taskforcesh/bullmq/compare/v5.74.2...v5.75.0) (2026-04-20) [](https://docs.bullmq.io#_5-75-0-2026-04-20)

### Features [](https://docs.bullmq.io#features-5)

- Nothing changed, triggered by a python version release

[5.74.2](https://github.com/taskforcesh/bullmq/compare/v5.74.1...v5.74.2) (2026-04-20) [](https://docs.bullmq.io#_5-74-2-2026-04-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-39)

- **types:**correct unsafe type cast in getJob to include undefined (- [37c4bb3](https://github.com/taskforcesh/bullmq/commit/37c4bb3725fe668fb4fbe27e3474b72eafa6a6fe))

[5.74.1](https://github.com/taskforcesh/bullmq/compare/v5.74.0...v5.74.1) (2026-04-15) [](https://docs.bullmq.io#_5-74-1-2026-04-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-40)

[5.74.0](https://github.com/taskforcesh/bullmq/compare/v5.73.5...v5.74.0) (2026-04-15) [](https://docs.bullmq.io#_5-74-0-2026-04-15)

### Features [](https://docs.bullmq.io#features-6)

[5.73.5](https://github.com/taskforcesh/bullmq/compare/v5.73.4...v5.73.5) (2026-04-12) [](https://docs.bullmq.io#_5-73-5-2026-04-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-41)

[5.73.4](https://github.com/taskforcesh/bullmq/compare/v5.73.3...v5.73.4) (2026-04-10) [](https://docs.bullmq.io#_5-73-4-2026-04-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-42)

[5.73.3](https://github.com/taskforcesh/bullmq/compare/v5.73.2...v5.73.3) (2026-04-09) [](https://docs.bullmq.io#_5-73-3-2026-04-09)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-2)

[5.73.2](https://github.com/taskforcesh/bullmq/compare/v5.73.1...v5.73.2) (2026-04-09) [](https://docs.bullmq.io#_5-73-2-2026-04-09)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-43)

[5.73.1](https://github.com/taskforcesh/bullmq/compare/v5.73.0...v5.73.1) (2026-04-08) [](https://docs.bullmq.io#_5-73-1-2026-04-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-44)

[5.73.0](https://github.com/taskforcesh/bullmq/compare/v5.72.1...v5.73.0) (2026-04-03) [](https://docs.bullmq.io#_5-73-0-2026-04-03)

### Features [](https://docs.bullmq.io#features-7)

[5.72.1](https://github.com/taskforcesh/bullmq/compare/v5.72.0...v5.72.1) (2026-04-02) [](https://docs.bullmq.io#_5-72-1-2026-04-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-45)

[5.72.0](https://github.com/taskforcesh/bullmq/compare/v5.71.1...v5.72.0) (2026-04-01) [](https://docs.bullmq.io#_5-72-0-2026-04-01)

### Features [](https://docs.bullmq.io#features-8)

- **deduplication:**add keepLastIfActive option for at-least-once-after-active semantics (- [#3902](https://github.com/taskforcesh/bullmq/issues/3902)) (- [aa529bc](https://github.com/taskforcesh/bullmq/commit/aa529bc512b15cdb9d173cc9cc3b0d9f8b8959eb))

[5.71.1](https://github.com/taskforcesh/bullmq/compare/v5.71.0...v5.71.1) (2026-03-25) [](https://docs.bullmq.io#_5-71-1-2026-03-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-46)

[5.71.0](https://github.com/taskforcesh/bullmq/compare/v5.70.4...v5.71.0) (2026-03-11) [](https://docs.bullmq.io#_5-71-0-2026-03-11)

### Features [](https://docs.bullmq.io#features-9)

[5.70.4](https://github.com/taskforcesh/bullmq/compare/v5.70.3...v5.70.4) (2026-03-06) [](https://docs.bullmq.io#_5-70-4-2026-03-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-47)

[5.70.3](https://github.com/taskforcesh/bullmq/compare/v5.70.2...v5.70.3) (2026-03-06) [](https://docs.bullmq.io#_5-70-3-2026-03-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-48)

[5.70.2](https://github.com/taskforcesh/bullmq/compare/v5.70.1...v5.70.2) (2026-03-05) [](https://docs.bullmq.io#_5-70-2-2026-03-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-49)

[5.70.1](https://github.com/taskforcesh/bullmq/compare/v5.70.0...v5.70.1) (2026-02-23) [](https://docs.bullmq.io#_5-70-1-2026-02-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-50)

[5.70.0](https://github.com/taskforcesh/bullmq/compare/v5.69.4...v5.70.0) (2026-02-21) [](https://docs.bullmq.io#_5-70-0-2026-02-21)

### Features [](https://docs.bullmq.io#features-10)

[5.69.4](https://github.com/taskforcesh/bullmq/compare/v5.69.3...v5.69.4) (2026-02-21) [](https://docs.bullmq.io#_5-69-4-2026-02-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-51)

[5.69.3](https://github.com/taskforcesh/bullmq/compare/v5.69.2...v5.69.3) (2026-02-16) [](https://docs.bullmq.io#_5-69-3-2026-02-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-52)

[5.69.2](https://github.com/taskforcesh/bullmq/compare/v5.69.1...v5.69.2) (2026-02-14) [](https://docs.bullmq.io#_5-69-2-2026-02-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-53)

[5.69.1](https://github.com/taskforcesh/bullmq/compare/v5.69.0...v5.69.1) (2026-02-13) [](https://docs.bullmq.io#_5-69-1-2026-02-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-54)

[5.69.0](https://github.com/taskforcesh/bullmq/compare/v5.68.0...v5.69.0) (2026-02-12) [](https://docs.bullmq.io#_5-69-0-2026-02-12)

### Features [](https://docs.bullmq.io#features-11)

[5.68.0](https://github.com/taskforcesh/bullmq/compare/v5.67.3...v5.68.0) (2026-02-11) [](https://docs.bullmq.io#_5-68-0-2026-02-11)

### Features [](https://docs.bullmq.io#features-12)

[5.67.3](https://github.com/taskforcesh/bullmq/compare/v5.67.2...v5.67.3) (2026-02-05) [](https://docs.bullmq.io#_5-67-3-2026-02-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-55)

[5.67.2](https://github.com/taskforcesh/bullmq/compare/v5.67.1...v5.67.2) (2026-01-28) [](https://docs.bullmq.io#_5-67-2-2026-01-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-56)

[5.67.1](https://github.com/taskforcesh/bullmq/compare/v5.67.0...v5.67.1) (2026-01-24) [](https://docs.bullmq.io#_5-67-1-2026-01-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-57)

[5.67.0](https://github.com/taskforcesh/bullmq/compare/v5.66.7...v5.67.0) (2026-01-24) [](https://docs.bullmq.io#_5-67-0-2026-01-24)

### Features [](https://docs.bullmq.io#features-13)

- **job:**add job name and id as telemetry attributes in complete, retry, delay and failed spans (- [#3707](https://github.com/taskforcesh/bullmq/issues/3707)) ref- [#3692](https://github.com/taskforcesh/bullmq/issues/3692)(- [6294b36](https://github.com/taskforcesh/bullmq/commit/6294b36f775c20f7d43387d9bde3185629e88df4))

[5.66.7](https://github.com/taskforcesh/bullmq/compare/v5.66.6...v5.66.7) (2026-01-23) [](https://docs.bullmq.io#_5-66-7-2026-01-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-58)

[5.66.6](https://github.com/taskforcesh/bullmq/compare/v5.66.5...v5.66.6) (2026-01-22) [](https://docs.bullmq.io#_5-66-6-2026-01-22)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-3)

[5.66.5](https://github.com/taskforcesh/bullmq/compare/v5.66.4...v5.66.5) (2026-01-12) [](https://docs.bullmq.io#_5-66-5-2026-01-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-59)

[5.66.4](https://github.com/taskforcesh/bullmq/compare/v5.66.3...v5.66.4) (2025-12-27) [](https://docs.bullmq.io#_5-66-4-2025-12-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-60)

[5.66.3](https://github.com/taskforcesh/bullmq/compare/v5.66.2...v5.66.3) (2025-12-26) [](https://docs.bullmq.io#_5-66-3-2025-12-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-61)

[5.66.2](https://github.com/taskforcesh/bullmq/compare/v5.66.1...v5.66.2) (2025-12-19) [](https://docs.bullmq.io#_5-66-2-2025-12-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-62)

[5.66.1](https://github.com/taskforcesh/bullmq/compare/v5.66.0...v5.66.1) (2025-12-17) [](https://docs.bullmq.io#_5-66-1-2025-12-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-63)

[5.66.0](https://github.com/taskforcesh/bullmq/compare/v5.65.1...v5.66.0) (2025-12-11) [](https://docs.bullmq.io#_5-66-0-2025-12-11)

### Features [](https://docs.bullmq.io#features-14)

- **job:**allow resetting attemptsMade and attemptsStarted attributes on retry (- [#3596](https://github.com/taskforcesh/bullmq/issues/3596)) ref- [#2152](https://github.com/taskforcesh/bullmq/issues/2152)(- [241d847](https://github.com/taskforcesh/bullmq/commit/241d847fbc798d957bf25ccfaa5c9ec96928a4ae))

[5.65.1](https://github.com/taskforcesh/bullmq/compare/v5.65.0...v5.65.1) (2025-12-01) [](https://docs.bullmq.io#_5-65-1-2025-12-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-64)

[5.65.0](https://github.com/taskforcesh/bullmq/compare/v5.64.1...v5.65.0) (2025-11-26) [](https://docs.bullmq.io#_5-65-0-2025-11-26)

### Features [](https://docs.bullmq.io#features-15)

[5.64.1](https://github.com/taskforcesh/bullmq/compare/v5.64.0...v5.64.1) (2025-11-21) [](https://docs.bullmq.io#_5-64-1-2025-11-21)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-4)

[5.64.0](https://github.com/taskforcesh/bullmq/compare/v5.63.2...v5.64.0) (2025-11-20) [](https://docs.bullmq.io#_5-64-0-2025-11-20)

### Features [](https://docs.bullmq.io#features-16)

[5.63.2](https://github.com/taskforcesh/bullmq/compare/v5.63.1...v5.63.2) (2025-11-15) [](https://docs.bullmq.io#_5-63-2-2025-11-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-65)

[5.63.1](https://github.com/taskforcesh/bullmq/compare/v5.63.0...v5.63.1) (2025-11-13) [](https://docs.bullmq.io#_5-63-1-2025-11-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-66)

[5.63.0](https://github.com/taskforcesh/bullmq/compare/v5.62.2...v5.63.0) (2025-10-31) [](https://docs.bullmq.io#_5-63-0-2025-10-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-67)

### Features [](https://docs.bullmq.io#features-17)

[5.62.2](https://github.com/taskforcesh/bullmq/compare/v5.62.1...v5.62.2) (2025-10-30) [](https://docs.bullmq.io#_5-62-2-2025-10-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-68)

[5.62.1](https://github.com/taskforcesh/bullmq/compare/v5.62.0...v5.62.1) (2025-10-30) [](https://docs.bullmq.io#_5-62-1-2025-10-30)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-5)

[5.62.0](https://github.com/taskforcesh/bullmq/compare/v5.61.2...v5.62.0) (2025-10-28) [](https://docs.bullmq.io#_5-62-0-2025-10-28)

### Features [](https://docs.bullmq.io#features-18)

[5.61.2](https://github.com/taskforcesh/bullmq/compare/v5.61.0...v5.61.2) (2025-10-23) [](https://docs.bullmq.io#_5-61-2-2025-10-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-69)

- **worker:**only emit error when moveToActive failed (- [0aa7cc5](https://github.com/taskforcesh/bullmq/commit/0aa7cc57db27a4e7b9fe3c5f52600abba749b053))
- **queue:**emit removed event when calling remove method (- [#3492](https://github.com/taskforcesh/bullmq/issues/3492)) fixes- [#2668](https://github.com/taskforcesh/bullmq/issues/2668)(- [7a3f2fa1](https://github.com/taskforcesh/bullmq/commit/7a3f2fa131e20de80c45877a1018e1ccdf8a6506))
- **worker:**emit error once when failure happens in moveToFinished (- [#3498](https://github.com/taskforcesh/bullmq/issues/3498)) (- [4b4bd97e](https://github.com/taskforcesh/bullmq/commit/4b4bd97ee78af861121e2ccb90f210e4a74fbd26))

[5.61.0](https://github.com/taskforcesh/bullmq/compare/v5.60.0...v5.61.0) (2025-10-06) [](https://docs.bullmq.io#_5-61-0-2025-10-06)

### Features [](https://docs.bullmq.io#features-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-70)

[5.60.0](https://github.com/taskforcesh/bullmq/compare/v5.59.0...v5.60.0) (2025-10-03) [](https://docs.bullmq.io#_5-60-0-2025-10-03)

### Features [](https://docs.bullmq.io#features-20)

[5.59.0](https://github.com/taskforcesh/bullmq/compare/v5.58.9...v5.59.0) (2025-09-29) [](https://docs.bullmq.io#_5-59-0-2025-09-29)

### Features [](https://docs.bullmq.io#features-21)

- **deduplication:**support replace option in single mode (- [#3472](https://github.com/taskforcesh/bullmq/issues/3472)) (- [eea35b7](https://github.com/taskforcesh/bullmq/commit/eea35b763c0965e129cf0ef4a104d05aa1f65f74))
- **sandbox:**support mjs files (- [#3476](https://github.com/taskforcesh/bullmq/issues/3476)) ref- [#3474](https://github.com/taskforcesh/bullmq/issues/3474)(- [2e2b214](https://github.com/taskforcesh/bullmq/commit/2e2b21454cc6125fcf3abfec939d6d6d8d02c40b))
- **worker:**support maxStartedAttempts option (- [#3331](https://github.com/taskforcesh/bullmq/issues/3331)) (- [9384a64](https://github.com/taskforcesh/bullmq/commit/9384a64d6d48718220e472c26d0c03e7b7e8e555))

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-6)

[5.58.9](https://github.com/taskforcesh/bullmq/compare/v5.58.8...v5.58.9) (2025-09-26) [](https://docs.bullmq.io#_5-58-9-2025-09-26)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-7)

[5.58.8](https://github.com/taskforcesh/bullmq/compare/v5.58.7...v5.58.8) (2025-09-25) [](https://docs.bullmq.io#_5-58-8-2025-09-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-71)

[5.58.7](https://github.com/taskforcesh/bullmq/compare/v5.58.6...v5.58.7) (2025-09-19) [](https://docs.bullmq.io#_5-58-7-2025-09-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-72)

[5.58.6](https://github.com/taskforcesh/bullmq/compare/v5.58.5...v5.58.6) (2025-09-19) [](https://docs.bullmq.io#_5-58-6-2025-09-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-73)

- **deps:**upgrade uuid to v11 (- [#3452](https://github.com/taskforcesh/bullmq/issues/3452)) (- [bd8fbc1](https://github.com/taskforcesh/bullmq/commit/bd8fbc164caaa01f665d0c7e94177d0584d04f8c))
- **events:**set prev param as active when calling retryJob script (- [#3426](https://github.com/taskforcesh/bullmq/issues/3426)) (- [e0ebd15](https://github.com/taskforcesh/bullmq/commit/e0ebd15e47b95f9300d6683475ec5d2176f07c95))
- **deduplication:**validate id option is provided (- [#3443](https://github.com/taskforcesh/bullmq/issues/3443)) fixes- [#3432](https://github.com/taskforcesh/bullmq/issues/3432)(- [533b844](https://github.com/taskforcesh/bullmq/commit/533b84461a908a3d0182002f16e9c0c0a0260014))

[5.58.5](https://github.com/taskforcesh/bullmq/compare/v5.58.4...v5.58.5) (2025-09-04) [](https://docs.bullmq.io#_5-58-5-2025-09-04)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-74)

[5.58.4](https://github.com/taskforcesh/bullmq/compare/v5.58.3...v5.58.4) (2025-08-30) [](https://docs.bullmq.io#_5-58-4-2025-08-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-75)

[5.58.3](https://github.com/taskforcesh/bullmq/compare/v5.58.2...v5.58.3) (2025-08-29) [](https://docs.bullmq.io#_5-58-3-2025-08-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-76)

[5.58.2](https://github.com/taskforcesh/bullmq/compare/v5.58.1...v5.58.2) (2025-08-26) [](https://docs.bullmq.io#_5-58-2-2025-08-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-77)

[5.58.1](https://github.com/taskforcesh/bullmq/compare/v5.58.0...v5.58.1) (2025-08-23) [](https://docs.bullmq.io#_5-58-1-2025-08-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-78)

[5.58.0](https://github.com/taskforcesh/bullmq/compare/v5.57.0...v5.58.0) (2025-08-15) [](https://docs.bullmq.io#_5-58-0-2025-08-15)

### Features [](https://docs.bullmq.io#features-22)

[5.57.0](https://github.com/taskforcesh/bullmq/compare/v5.56.10...v5.57.0) (2025-08-13) [](https://docs.bullmq.io#_5-57-0-2025-08-13)

### Features [](https://docs.bullmq.io#features-23)

[5.56.10](https://github.com/taskforcesh/bullmq/compare/v5.56.9...v5.56.10) (2025-08-10) [](https://docs.bullmq.io#_5-56-10-2025-08-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-79)

- **scheduler:**consider startDate to generate nextMillis when using pattern (- [#3385](https://github.com/taskforcesh/bullmq/issues/3385)) fixes- [#3378](https://github.com/taskforcesh/bullmq/issues/3378)(- [53754fb](https://github.com/taskforcesh/bullmq/commit/53754fb239cf1b021ffc55391990d879d363dcf7))

[5.56.9](https://github.com/taskforcesh/bullmq/compare/v5.56.8...v5.56.9) (2025-07-31) [](https://docs.bullmq.io#_5-56-9-2025-07-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-80)

[5.56.8](https://github.com/taskforcesh/bullmq/compare/v5.56.7...v5.56.8) (2025-07-27) [](https://docs.bullmq.io#_5-56-8-2025-07-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-81)

[5.56.7](https://github.com/taskforcesh/bullmq/compare/v5.56.6...v5.56.7) (2025-07-25) [](https://docs.bullmq.io#_5-56-7-2025-07-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-82)

- **flow:**remove parent from active when there are unsuccessful children (- [#3348](https://github.com/taskforcesh/bullmq/issues/3348)) (- [34ee339](https://github.com/taskforcesh/bullmq/commit/34ee33955a660b0696f4b6cff6d8d39fdcd160db))
- **worker:**do not keep active jobs when pausing or closing (- [#3350](https://github.com/taskforcesh/bullmq/issues/3350)) fixes- [#3349](https://github.com/taskforcesh/bullmq/issues/3349)(- [424d155](https://github.com/taskforcesh/bullmq/commit/424d15508172a028479059920ed6bfcf1c54a389))

[5.56.6](https://github.com/taskforcesh/bullmq/compare/v5.56.5...v5.56.6) (2025-07-25) [](https://docs.bullmq.io#_5-56-6-2025-07-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-83)

- **repeat:**use legacy updateRepeatableJob script when old format is present (- [#3364](https://github.com/taskforcesh/bullmq/issues/3364)) fixes- [#3275](https://github.com/taskforcesh/bullmq/issues/3275)(- [1e221d5](https://github.com/taskforcesh/bullmq/commit/1e221d5404dcea750a08342c832a682e454135a3))

[5.56.5](https://github.com/taskforcesh/bullmq/compare/v5.56.4...v5.56.5) (2025-07-19) [](https://docs.bullmq.io#_5-56-5-2025-07-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-84)

[5.56.4](https://github.com/taskforcesh/bullmq/compare/v5.56.3...v5.56.4) (2025-07-11) [](https://docs.bullmq.io#_5-56-4-2025-07-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-85)

- **connection:**ignore info command when skipVersionCheck is provided as true (- [#3342](https://github.com/taskforcesh/bullmq/issues/3342)) fixes- [#3341](https://github.com/taskforcesh/bullmq/issues/3341)(- [b94d7ed](https://github.com/taskforcesh/bullmq/commit/b94d7ed5602e366b4401051b236f31ac2dd2a90d))

[5.56.3](https://github.com/taskforcesh/bullmq/compare/v5.56.2...v5.56.3) (2025-07-10) [](https://docs.bullmq.io#_5-56-3-2025-07-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-86)

[5.56.2](https://github.com/taskforcesh/bullmq/compare/v5.56.1...v5.56.2) (2025-07-08) [](https://docs.bullmq.io#_5-56-2-2025-07-08)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-8)

[5.56.1](https://github.com/taskforcesh/bullmq/compare/v5.56.0...v5.56.1) (2025-07-03) [](https://docs.bullmq.io#_5-56-1-2025-07-03)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-9)

[5.56.0](https://github.com/taskforcesh/bullmq/compare/v5.55.0...v5.56.0) (2025-06-22) [](https://docs.bullmq.io#_5-56-0-2025-06-22)

### Features [](https://docs.bullmq.io#features-24)

[5.55.0](https://github.com/taskforcesh/bullmq/compare/v5.54.3...v5.55.0) (2025-06-21) [](https://docs.bullmq.io#_5-55-0-2025-06-21)

### Features [](https://docs.bullmq.io#features-25)

[5.54.3](https://github.com/taskforcesh/bullmq/compare/v5.54.2...v5.54.3) (2025-06-18) [](https://docs.bullmq.io#_5-54-3-2025-06-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-87)

[5.54.2](https://github.com/taskforcesh/bullmq/compare/v5.54.1...v5.54.2) (2025-06-17) [](https://docs.bullmq.io#_5-54-2-2025-06-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-88)

[5.54.1](https://github.com/taskforcesh/bullmq/compare/v5.54.0...v5.54.1) (2025-06-17) [](https://docs.bullmq.io#_5-54-1-2025-06-17)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-10)

[5.54.0](https://github.com/taskforcesh/bullmq/compare/v5.53.3...v5.54.0) (2025-06-15) [](https://docs.bullmq.io#_5-54-0-2025-06-15)

### Features [](https://docs.bullmq.io#features-26)

[5.53.3](https://github.com/taskforcesh/bullmq/compare/v5.53.2...v5.53.3) (2025-06-13) [](https://docs.bullmq.io#_5-53-3-2025-06-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-89)

[5.53.2](https://github.com/taskforcesh/bullmq/compare/v5.53.1...v5.53.2) (2025-06-02) [](https://docs.bullmq.io#_5-53-2-2025-06-02)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-11)

[5.53.1](https://github.com/taskforcesh/bullmq/compare/v5.53.0...v5.53.1) (2025-05-30) [](https://docs.bullmq.io#_5-53-1-2025-05-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-90)

- **job:**do not parse ignored failures in getDependencies (- [#3284](https://github.com/taskforcesh/bullmq/issues/3284)) fixes- [#3283](https://github.com/taskforcesh/bullmq/issues/3283)(- [04ca6b5](https://github.com/taskforcesh/bullmq/commit/04ca6b55c15698aab3ceaf72bd2ed9c589d76197))
- **scheduler:**remove current job when it is in delayed state (- [#3269](https://github.com/taskforcesh/bullmq/issues/3269)) fixes- [#3262](https://github.com/taskforcesh/bullmq/issues/3262)- [#3272](https://github.com/taskforcesh/bullmq/issues/3272)(- [1ca4cbd](https://github.com/taskforcesh/bullmq/commit/1ca4cbd17a58c7eba83030bd6440d0f5e5d69633))

[5.53.0](https://github.com/taskforcesh/bullmq/compare/v5.52.3...v5.53.0) (2025-05-21) [](https://docs.bullmq.io#_5-53-0-2025-05-21)

### Features [](https://docs.bullmq.io#features-27)

[5.52.3](https://github.com/taskforcesh/bullmq/compare/v5.52.2...v5.52.3) (2025-05-19) [](https://docs.bullmq.io#_5-52-3-2025-05-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-91)

### Features [](https://docs.bullmq.io#features-28)

[5.52.2](https://github.com/taskforcesh/bullmq/compare/v5.52.1...v5.52.2) (2025-05-08) [](https://docs.bullmq.io#_5-52-2-2025-05-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-92)

[5.52.1](https://github.com/taskforcesh/bullmq/compare/v5.52.0...v5.52.1) (2025-05-02) [](https://docs.bullmq.io#_5-52-1-2025-05-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-93)

[5.52.0](https://github.com/taskforcesh/bullmq/compare/v5.51.1...v5.52.0) (2025-05-01) [](https://docs.bullmq.io#_5-52-0-2025-05-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-94)

### Features [](https://docs.bullmq.io#features-29)

[5.51.1](https://github.com/taskforcesh/bullmq/compare/v5.51.0...v5.51.1) (2025-04-26) [](https://docs.bullmq.io#_5-51-1-2025-04-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-95)

[5.51.0](https://github.com/taskforcesh/bullmq/compare/v5.50.0...v5.51.0) (2025-04-25) [](https://docs.bullmq.io#_5-51-0-2025-04-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-96)

- **job-scheduler:**remove next delayed job if present even if scheduler does not exist (- [#3203](https://github.com/taskforcesh/bullmq/issues/3203)) ref- [#3197](https://github.com/taskforcesh/bullmq/issues/3197)(- [61395bf](https://github.com/taskforcesh/bullmq/commit/61395bf0b2fc656d1cdaf094fc62a03920ebe07d))

### Features [](https://docs.bullmq.io#features-30)

[5.50.0](https://github.com/taskforcesh/bullmq/compare/v5.49.2...v5.50.0) (2025-04-25) [](https://docs.bullmq.io#_5-50-0-2025-04-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-97)

- **deduplication:**remove deduplication key only when jobId matches with the last one being saved (- [#3236](https://github.com/taskforcesh/bullmq/issues/3236)) (- [192e82c](https://github.com/taskforcesh/bullmq/commit/192e82caa0f7f530ed495740ec2ade37fe89b43b))

### Features [](https://docs.bullmq.io#features-31)

[5.49.2](https://github.com/taskforcesh/bullmq/compare/v5.49.1...v5.49.2) (2025-04-21) [](https://docs.bullmq.io#_5-49-2-2025-04-21)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-12)

[5.49.1](https://github.com/taskforcesh/bullmq/compare/v5.49.0...v5.49.1) (2025-04-17) [](https://docs.bullmq.io#_5-49-1-2025-04-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-98)

[5.49.0](https://github.com/taskforcesh/bullmq/compare/v5.48.1...v5.49.0) (2025-04-16) [](https://docs.bullmq.io#_5-49-0-2025-04-16)

### Features [](https://docs.bullmq.io#features-32)

[5.48.1](https://github.com/taskforcesh/bullmq/compare/v5.48.0...v5.48.1) (2025-04-10) [](https://docs.bullmq.io#_5-48-1-2025-04-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-99)

[5.48.0](https://github.com/taskforcesh/bullmq/compare/v5.47.3...v5.48.0) (2025-04-08) [](https://docs.bullmq.io#_5-48-0-2025-04-08)

### Features [](https://docs.bullmq.io#features-33)

[5.47.3](https://github.com/taskforcesh/bullmq/compare/v5.47.2...v5.47.3) (2025-04-08) [](https://docs.bullmq.io#_5-47-3-2025-04-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-100)

[5.47.2](https://github.com/taskforcesh/bullmq/compare/v5.47.1...v5.47.2) (2025-04-06) [](https://docs.bullmq.io#_5-47-2-2025-04-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-101)

- **flow:**remove job from dependencies when failParentOnFailure or continueParentOnFailure (- [#3201](https://github.com/taskforcesh/bullmq/issues/3201)) (- [1fbcbec](https://github.com/taskforcesh/bullmq/commit/1fbcbec56969fc4aa628f77e4b05d2c6844894ae))

[5.47.1](https://github.com/taskforcesh/bullmq/compare/v5.47.0...v5.47.1) (2025-04-05) [](https://docs.bullmq.io#_5-47-1-2025-04-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-102)

[5.47.0](https://github.com/taskforcesh/bullmq/compare/v5.46.1...v5.47.0) (2025-04-04) [](https://docs.bullmq.io#_5-47-0-2025-04-04)

### Features [](https://docs.bullmq.io#features-34)

[5.46.1](https://github.com/taskforcesh/bullmq/compare/v5.46.0...v5.46.1) (2025-04-03) [](https://docs.bullmq.io#_5-46-1-2025-04-03)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-103)

[5.46.0](https://github.com/taskforcesh/bullmq/compare/v5.45.2...v5.46.0) (2025-04-02) [](https://docs.bullmq.io#_5-46-0-2025-04-02)

### Features [](https://docs.bullmq.io#features-35)

[5.45.2](https://github.com/taskforcesh/bullmq/compare/v5.45.1...v5.45.2) (2025-03-29) [](https://docs.bullmq.io#_5-45-2-2025-03-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-104)

[5.45.1](https://github.com/taskforcesh/bullmq/compare/v5.45.0...v5.45.1) (2025-03-29) [](https://docs.bullmq.io#_5-45-1-2025-03-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-105)

[5.45.0](https://github.com/taskforcesh/bullmq/compare/v5.44.4...v5.45.0) (2025-03-27) [](https://docs.bullmq.io#_5-45-0-2025-03-27)

### Features [](https://docs.bullmq.io#features-36)

- add deduplicated job id to the deduplicated event ([0f21c10](https://github.com/taskforcesh/bullmq/commit/0f21c10bc9fd9a2290e8dde3c9b43bc366fcb15a))

[5.44.4](https://github.com/taskforcesh/bullmq/compare/v5.44.3...v5.44.4) (2025-03-24) [](https://docs.bullmq.io#_5-44-4-2025-03-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-106)

[5.44.3](https://github.com/taskforcesh/bullmq/compare/v5.44.2...v5.44.3) (2025-03-22) [](https://docs.bullmq.io#_5-44-3-2025-03-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-107)

[5.44.2](https://github.com/taskforcesh/bullmq/compare/v5.44.1...v5.44.2) (2025-03-22) [](https://docs.bullmq.io#_5-44-2-2025-03-22)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-13)

[5.44.1](https://github.com/taskforcesh/bullmq/compare/v5.44.0...v5.44.1) (2025-03-21) [](https://docs.bullmq.io#_5-44-1-2025-03-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-108)

[5.44.0](https://github.com/taskforcesh/bullmq/compare/v5.43.1...v5.44.0) (2025-03-18) [](https://docs.bullmq.io#_5-44-0-2025-03-18)

### Features [](https://docs.bullmq.io#features-37)

- **prometheus export:**expose global variables (- [0325a39](https://github.com/taskforcesh/bullmq/commit/0325a39f4243f3bea682bcfc20dc43b62d3f9fd9))

[5.43.1](https://github.com/taskforcesh/bullmq/compare/v5.43.0...v5.43.1) (2025-03-15) [](https://docs.bullmq.io#_5-43-1-2025-03-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-109)

[5.43.0](https://github.com/taskforcesh/bullmq/compare/v5.42.0...v5.43.0) (2025-03-13) [](https://docs.bullmq.io#_5-43-0-2025-03-13)

### Features [](https://docs.bullmq.io#features-38)

[5.42.0](https://github.com/taskforcesh/bullmq/compare/v5.41.9...v5.42.0) (2025-03-12) [](https://docs.bullmq.io#_5-42-0-2025-03-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-110)

- **flow:**consider to fail a parent not in waiting-children when failParentOnFailure is provided (- [#3098](https://github.com/taskforcesh/bullmq/issues/3098)) (- [589adb4](https://github.com/taskforcesh/bullmq/commit/589adb4f89bcb7d7721200333c2d605eb6ba7864))
- **job-scheduler:**restore iterationCount attribute (- [#3134](https://github.com/taskforcesh/bullmq/issues/3134)) (- [eec7114](https://github.com/taskforcesh/bullmq/commit/eec711468de39ec10da9206d7f8c5ad1eb0df882))

### Features [](https://docs.bullmq.io#features-39)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-14)

[5.41.9](https://github.com/taskforcesh/bullmq/compare/v5.41.8...v5.41.9) (2025-03-11) [](https://docs.bullmq.io#_5-41-9-2025-03-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-111)

[5.41.8](https://github.com/taskforcesh/bullmq/compare/v5.41.7...v5.41.8) (2025-03-08) [](https://docs.bullmq.io#_5-41-8-2025-03-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-112)

- **job:**deserialize priority in fromJSON (- [#3126](https://github.com/taskforcesh/bullmq/issues/3126)) (- [c3269b1](https://github.com/taskforcesh/bullmq/commit/c3269b11e2def4e2acd4eafc02ce7958a8fcf63e))
- **worker:**cast delay_until to integer [python] (- [#3116](https://github.com/taskforcesh/bullmq/issues/3116)) (- [db617e4](https://github.com/taskforcesh/bullmq/commit/db617e48ef1dd52446bfd73e15f24957df2ca315))

[5.41.7](https://github.com/taskforcesh/bullmq/compare/v5.41.6...v5.41.7) (2025-02-27) [](https://docs.bullmq.io#_5-41-7-2025-02-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-113)

[5.41.6](https://github.com/taskforcesh/bullmq/compare/v5.41.5...v5.41.6) (2025-02-26) [](https://docs.bullmq.io#_5-41-6-2025-02-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-114)

- **flow:**consider delayed state when moving a parent to failed (- [#3112](https://github.com/taskforcesh/bullmq/issues/3112)) (- [6a28b86](https://github.com/taskforcesh/bullmq/commit/6a28b861346a3efa89574a78b396954d6c4ed113))
- **telemetry:**fix span name for moveToFailed logic (- [#3113](https://github.com/taskforcesh/bullmq/issues/3113)) (- [7a4b500](https://github.com/taskforcesh/bullmq/commit/7a4b500dc63320807e051d8efd2b8fee07bb0db5))

[5.41.5](https://github.com/taskforcesh/bullmq/compare/v5.41.4...v5.41.5) (2025-02-21) [](https://docs.bullmq.io#_5-41-5-2025-02-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-115)

[5.41.4](https://github.com/taskforcesh/bullmq/compare/v5.41.3...v5.41.4) (2025-02-21) [](https://docs.bullmq.io#_5-41-4-2025-02-21)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-15)

[5.41.3](https://github.com/taskforcesh/bullmq/compare/v5.41.2...v5.41.3) (2025-02-19) [](https://docs.bullmq.io#_5-41-3-2025-02-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-116)

[5.41.2](https://github.com/taskforcesh/bullmq/compare/v5.41.1...v5.41.2) (2025-02-16) [](https://docs.bullmq.io#_5-41-2-2025-02-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-117)

[5.41.1](https://github.com/taskforcesh/bullmq/compare/v5.41.0...v5.41.1) (2025-02-15) [](https://docs.bullmq.io#_5-41-1-2025-02-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-118)

[5.41.0](https://github.com/taskforcesh/bullmq/compare/v5.40.5...v5.41.0) (2025-02-14) [](https://docs.bullmq.io#_5-41-0-2025-02-14)

### Features [](https://docs.bullmq.io#features-40)

- **job:**add moveToWait method for manual processing (- [#2978](https://github.com/taskforcesh/bullmq/issues/2978)) (- [5a97491](https://github.com/taskforcesh/bullmq/commit/5a97491a0319df320b7858657e03c357284e0108))
- **queue:**support removeGlobalConcurrency method (- [#3076](https://github.com/taskforcesh/bullmq/issues/3076)) (- [ece8532](https://github.com/taskforcesh/bullmq/commit/ece853203adb420466dfaf3ff8bccc73fb917147))

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-16)

[5.40.5](https://github.com/taskforcesh/bullmq/compare/v5.40.4...v5.40.5) (2025-02-14) [](https://docs.bullmq.io#_5-40-5-2025-02-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-119)

[5.40.4](https://github.com/taskforcesh/bullmq/compare/v5.40.3...v5.40.4) (2025-02-13) [](https://docs.bullmq.io#_5-40-4-2025-02-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-120)

[5.40.3](https://github.com/taskforcesh/bullmq/compare/v5.40.2...v5.40.3) (2025-02-12) [](https://docs.bullmq.io#_5-40-3-2025-02-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-121)

- **job-scheduler:**return undefined in getJobScheduler when it does not exist (- [#3065](https://github.com/taskforcesh/bullmq/issues/3065)) fixes- [#3062](https://github.com/taskforcesh/bullmq/issues/3062)(- [548cc1c](https://github.com/taskforcesh/bullmq/commit/548cc1ce8080042b4b44009ea99108bd24193895))

[5.40.2](https://github.com/taskforcesh/bullmq/compare/v5.40.1...v5.40.2) (2025-02-07) [](https://docs.bullmq.io#_5-40-2-2025-02-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-122)

- fix return type of getNextJob ([b970281](https://github.com/taskforcesh/bullmq/commit/b9702812e6961f0f5a834f66d43cfb2feabaafd8))

[5.40.1](https://github.com/taskforcesh/bullmq/compare/v5.40.0...v5.40.1) (2025-02-07) [](https://docs.bullmq.io#_5-40-1-2025-02-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-123)

[5.40.0](https://github.com/taskforcesh/bullmq/compare/v5.39.2...v5.40.0) (2025-02-02) [](https://docs.bullmq.io#_5-40-0-2025-02-02)

### Features [](https://docs.bullmq.io#features-41)

- **job-scheduler:**revert add delayed job and update in the same script (- [9f0f1ba](https://github.com/taskforcesh/bullmq/commit/9f0f1ba9b17874a757ac38c1878792c0df3c5a9a))

[5.39.2](https://github.com/taskforcesh/bullmq/compare/v5.39.1...v5.39.2) (2025-02-02) [](https://docs.bullmq.io#_5-39-2-2025-02-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-124)

[5.39.1](https://github.com/taskforcesh/bullmq/compare/v5.39.0...v5.39.1) (2025-01-30) [](https://docs.bullmq.io#_5-39-1-2025-01-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-125)

[5.39.0](https://github.com/taskforcesh/bullmq/compare/v5.38.0...v5.39.0) (2025-01-29) [](https://docs.bullmq.io#_5-39-0-2025-01-29)

### Features [](https://docs.bullmq.io#features-42)

[5.38.0](https://github.com/taskforcesh/bullmq/compare/v5.37.0...v5.38.0) (2025-01-28) [](https://docs.bullmq.io#_5-38-0-2025-01-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-126)

- **flow-producer:**add support for skipWaitingForReady (- [6d829fc](https://github.com/taskforcesh/bullmq/commit/6d829fceda9f204f193c533ffc780962692b8f16))

### Features [](https://docs.bullmq.io#features-43)

- **queue:**add option to skip wait until connection ready (- [e728299](https://github.com/taskforcesh/bullmq/commit/e72829922d4234b92290346dce5d33f5b98ee373))

[5.37.0](https://github.com/taskforcesh/bullmq/compare/v5.36.0...v5.37.0) (2025-01-25) [](https://docs.bullmq.io#_5-37-0-2025-01-25)

### Features [](https://docs.bullmq.io#features-44)

- **queue-getters:**add prometheus exporter (- [078ae9d](https://github.com/taskforcesh/bullmq/commit/078ae9db80f6ca64ff0a8135b57a6dc71d71cb1e))

[5.36.0](https://github.com/taskforcesh/bullmq/compare/v5.35.1...v5.36.0) (2025-01-24) [](https://docs.bullmq.io#_5-36-0-2025-01-24)

### Features [](https://docs.bullmq.io#features-45)

[5.35.1](https://github.com/taskforcesh/bullmq/compare/v5.35.0...v5.35.1) (2025-01-23) [](https://docs.bullmq.io#_5-35-1-2025-01-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-127)

- **worker:**avoid possible hazard in closing worker (- [0f07467](https://github.com/taskforcesh/bullmq/commit/0f0746727176d7ff285ae2d1f35048109b4574c5))

[5.35.0](https://github.com/taskforcesh/bullmq/compare/v5.34.10...v5.35.0) (2025-01-22) [](https://docs.bullmq.io#_5-35-0-2025-01-22)

### Features [](https://docs.bullmq.io#features-46)

- **sandbox:**add support for getChildrenValues (- [dcc3b06](https://github.com/taskforcesh/bullmq/commit/dcc3b0628f992546d7b93f509795e5d4eb3e1b15))

[5.34.10](https://github.com/taskforcesh/bullmq/compare/v5.34.9...v5.34.10) (2025-01-14) [](https://docs.bullmq.io#_5-34-10-2025-01-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-128)

[5.34.9](https://github.com/taskforcesh/bullmq/compare/v5.34.8...v5.34.9) (2025-01-12) [](https://docs.bullmq.io#_5-34-9-2025-01-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-129)

[5.34.8](https://github.com/taskforcesh/bullmq/compare/v5.34.7...v5.34.8) (2025-01-08) [](https://docs.bullmq.io#_5-34-8-2025-01-08)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-17)

[5.34.7](https://github.com/taskforcesh/bullmq/compare/v5.34.6...v5.34.7) (2025-01-06) [](https://docs.bullmq.io#_5-34-7-2025-01-06)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-18)

[5.34.6](https://github.com/taskforcesh/bullmq/compare/v5.34.5...v5.34.6) (2024-12-31) [](https://docs.bullmq.io#_5-34-6-2024-12-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-130)

[5.34.5](https://github.com/taskforcesh/bullmq/compare/v5.34.4...v5.34.5) (2024-12-25) [](https://docs.bullmq.io#_5-34-5-2024-12-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-131)

[5.34.4](https://github.com/taskforcesh/bullmq/compare/v5.34.3...v5.34.4) (2024-12-21) [](https://docs.bullmq.io#_5-34-4-2024-12-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-132)

[5.34.3](https://github.com/taskforcesh/bullmq/compare/v5.34.2...v5.34.3) (2024-12-18) [](https://docs.bullmq.io#_5-34-3-2024-12-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-133)

[5.34.2](https://github.com/taskforcesh/bullmq/compare/v5.34.1...v5.34.2) (2024-12-14) [](https://docs.bullmq.io#_5-34-2-2024-12-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-134)

- **scripts:**make sure jobs fields are not empty before unpack (- [4360572](https://github.com/taskforcesh/bullmq/commit/4360572745a929c7c4f6266ec03d4eba77a9715c))

[5.34.1](https://github.com/taskforcesh/bullmq/compare/v5.34.0...v5.34.1) (2024-12-13) [](https://docs.bullmq.io#_5-34-1-2024-12-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-135)

- guarantee every repeatable jobs are slotted ([9917df1](https://github.com/taskforcesh/bullmq/commit/9917df166aff2e2f143c45297f41ac8520bfc8ae))
- **job-scheduler:**avoid duplicated delayed jobs when repeatable jobs are retried (- [af75315](https://github.com/taskforcesh/bullmq/commit/af75315f0c7923f5e0a667a9ed4606b28b89b719))

[5.34.0](https://github.com/taskforcesh/bullmq/compare/v5.33.1...v5.34.0) (2024-12-10) [](https://docs.bullmq.io#_5-34-0-2024-12-10)

### Features [](https://docs.bullmq.io#features-47)

[5.33.1](https://github.com/taskforcesh/bullmq/compare/v5.33.0...v5.33.1) (2024-12-10) [](https://docs.bullmq.io#_5-33-1-2024-12-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-136)

[5.33.0](https://github.com/taskforcesh/bullmq/compare/v5.32.0...v5.33.0) (2024-12-09) [](https://docs.bullmq.io#_5-33-0-2024-12-09)

### Features [](https://docs.bullmq.io#features-48)

[5.32.0](https://github.com/taskforcesh/bullmq/compare/v5.31.2...v5.32.0) (2024-12-08) [](https://docs.bullmq.io#_5-32-0-2024-12-08)

### Features [](https://docs.bullmq.io#features-49)

[5.31.2](https://github.com/taskforcesh/bullmq/compare/v5.31.1...v5.31.2) (2024-12-06) [](https://docs.bullmq.io#_5-31-2-2024-12-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-137)

[5.31.1](https://github.com/taskforcesh/bullmq/compare/v5.31.0...v5.31.1) (2024-12-04) [](https://docs.bullmq.io#_5-31-1-2024-12-04)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-138)

[5.31.0](https://github.com/taskforcesh/bullmq/compare/v5.30.1...v5.31.0) (2024-12-02) [](https://docs.bullmq.io#_5-31-0-2024-12-02)

### Features [](https://docs.bullmq.io#features-50)

[5.30.1](https://github.com/taskforcesh/bullmq/compare/v5.30.0...v5.30.1) (2024-11-30) [](https://docs.bullmq.io#_5-30-1-2024-11-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-139)

[5.30.0](https://github.com/taskforcesh/bullmq/compare/v5.29.1...v5.30.0) (2024-11-29) [](https://docs.bullmq.io#_5-30-0-2024-11-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-140)

### Features [](https://docs.bullmq.io#features-51)

[5.29.1](https://github.com/taskforcesh/bullmq/compare/v5.29.0...v5.29.1) (2024-11-23) [](https://docs.bullmq.io#_5-29-1-2024-11-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-141)

[5.29.0](https://github.com/taskforcesh/bullmq/compare/v5.28.2...v5.29.0) (2024-11-22) [](https://docs.bullmq.io#_5-29-0-2024-11-22)

### Features [](https://docs.bullmq.io#features-52)

- **queue:**refactor a protected addJob method allowing telemetry extensions (- [09f2571](https://github.com/taskforcesh/bullmq/commit/09f257196f6d5a6690edbf55f12d585cec86ee8f))

[5.28.2](https://github.com/taskforcesh/bullmq/compare/v5.28.1...v5.28.2) (2024-11-22) [](https://docs.bullmq.io#_5-28-2-2024-11-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-142)

[5.28.1](https://github.com/taskforcesh/bullmq/compare/v5.28.0...v5.28.1) (2024-11-20) [](https://docs.bullmq.io#_5-28-1-2024-11-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-143)

[5.28.0](https://github.com/taskforcesh/bullmq/compare/v5.27.0...v5.28.0) (2024-11-19) [](https://docs.bullmq.io#_5-28-0-2024-11-19)

### Features [](https://docs.bullmq.io#features-53)

- **job-scheduler:**add telemetry support to the job scheduler (- [72ea950](https://github.com/taskforcesh/bullmq/commit/72ea950ea251aa12f879ba19c0b5dfeb6a093da2))

[5.27.0](https://github.com/taskforcesh/bullmq/compare/v5.26.2...v5.27.0) (2024-11-19) [](https://docs.bullmq.io#_5-27-0-2024-11-19)

### Features [](https://docs.bullmq.io#features-54)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-19)

[5.26.2](https://github.com/taskforcesh/bullmq/compare/v5.26.1...v5.26.2) (2024-11-15) [](https://docs.bullmq.io#_5-26-2-2024-11-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-144)

- **telemetry:**do not set span on parent context if undefined (- [c417a23](https://github.com/taskforcesh/bullmq/commit/c417a23bb28d9effa42115e954b18cc41c1fc043))

[5.26.1](https://github.com/taskforcesh/bullmq/compare/v5.26.0...v5.26.1) (2024-11-14) [](https://docs.bullmq.io#_5-26-1-2024-11-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-145)

- **queue:**fix generics to be able to properly be extended (- [f2495e5](https://github.com/taskforcesh/bullmq/commit/f2495e5ee9ecdb26492da510dc38730718cb28c5))

[5.26.0](https://github.com/taskforcesh/bullmq/compare/v5.25.6...v5.26.0) (2024-11-14) [](https://docs.bullmq.io#_5-26-0-2024-11-14)

### Features [](https://docs.bullmq.io#features-55)

[5.25.6](https://github.com/taskforcesh/bullmq/compare/v5.25.5...v5.25.6) (2024-11-11) [](https://docs.bullmq.io#_5-25-6-2024-11-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-146)

- **job-scheculer:**avoid hazards when upserting job schedulers concurrently (- [022f7b7](https://github.com/taskforcesh/bullmq/commit/022f7b7d0a0ce14387ed2b9fed791e1f56e34770))

[5.25.5](https://github.com/taskforcesh/bullmq/compare/v5.25.4...v5.25.5) (2024-11-11) [](https://docs.bullmq.io#_5-25-5-2024-11-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-147)

[5.25.4](https://github.com/taskforcesh/bullmq/compare/v5.25.3...v5.25.4) (2024-11-10) [](https://docs.bullmq.io#_5-25-4-2024-11-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-148)

- **repeatable:**only apply immediately in the first iteration (- [f69cfbc](https://github.com/taskforcesh/bullmq/commit/f69cfbcbc5516a854adbbc29b259d08e65a19705))

[5.25.3](https://github.com/taskforcesh/bullmq/compare/v5.25.2...v5.25.3) (2024-11-08) [](https://docs.bullmq.io#_5-25-3-2024-11-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-149)

[5.25.2](https://github.com/taskforcesh/bullmq/compare/v5.25.1...v5.25.2) (2024-11-08) [](https://docs.bullmq.io#_5-25-2-2024-11-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-150)

[5.25.1](https://github.com/taskforcesh/bullmq/compare/v5.25.0...v5.25.1) (2024-11-07) [](https://docs.bullmq.io#_5-25-1-2024-11-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-151)

[5.25.0](https://github.com/taskforcesh/bullmq/compare/v5.24.0...v5.25.0) (2024-11-06) [](https://docs.bullmq.io#_5-25-0-2024-11-06)

### Features [](https://docs.bullmq.io#features-56)

[5.24.0](https://github.com/taskforcesh/bullmq/compare/v5.23.1...v5.24.0) (2024-11-05) [](https://docs.bullmq.io#_5-24-0-2024-11-05)

### Features [](https://docs.bullmq.io#features-57)

[5.23.1](https://github.com/taskforcesh/bullmq/compare/v5.23.0...v5.23.1) (2024-11-05) [](https://docs.bullmq.io#_5-23-1-2024-11-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-152)

[5.23.0](https://github.com/taskforcesh/bullmq/compare/v5.22.0...v5.23.0) (2024-11-02) [](https://docs.bullmq.io#_5-23-0-2024-11-02)

### Features [](https://docs.bullmq.io#features-58)

[5.22.0](https://github.com/taskforcesh/bullmq/compare/v5.21.2...v5.22.0) (2024-10-31) [](https://docs.bullmq.io#_5-22-0-2024-10-31)

### Features [](https://docs.bullmq.io#features-59)

[5.21.2](https://github.com/taskforcesh/bullmq/compare/v5.21.1...v5.21.2) (2024-10-22) [](https://docs.bullmq.io#_5-21-2-2024-10-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-153)

- proper way to get version ([b4e25c1](https://github.com/taskforcesh/bullmq/commit/b4e25c13cafc001748ee6eb590133feb8ee24d7b))

[5.21.1](https://github.com/taskforcesh/bullmq/compare/v5.21.0...v5.21.1) (2024-10-18) [](https://docs.bullmq.io#_5-21-1-2024-10-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-154)

- **scripts:**add missing wait in isJobInList (- [9ef865c](https://github.com/taskforcesh/bullmq/commit/9ef865c7de6086cb3c906721fd046aeed1e0d27f))

[5.21.0](https://github.com/taskforcesh/bullmq/compare/v5.20.1...v5.21.0) (2024-10-18) [](https://docs.bullmq.io#_5-21-0-2024-10-18)

### Features [](https://docs.bullmq.io#features-60)

- **queue:**add option to skip metas update (- [b7dd925](https://github.com/taskforcesh/bullmq/commit/b7dd925e7f2a4468c98a05f3a3ca1a476482b6c0))

[5.20.1](https://github.com/taskforcesh/bullmq/compare/v5.20.0...v5.20.1) (2024-10-18) [](https://docs.bullmq.io#_5-20-1-2024-10-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-155)

- **redis:**use version for naming loaded lua scripts (- [fe73f6d](https://github.com/taskforcesh/bullmq/commit/fe73f6d4d776dc9f99ad3a094e5c59c5fafc96f1))

[5.20.0](https://github.com/taskforcesh/bullmq/compare/v5.19.1...v5.20.0) (2024-10-13) [](https://docs.bullmq.io#_5-20-0-2024-10-13)

### Features [](https://docs.bullmq.io#features-61)

[5.19.1](https://github.com/taskforcesh/bullmq/compare/v5.19.0...v5.19.1) (2024-10-12) [](https://docs.bullmq.io#_5-19-1-2024-10-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-156)

- **sandbox:**fix serialization of error with circular references are present (- [#2815](https://github.com/taskforcesh/bullmq/issues/2815)) fix- [#2813](https://github.com/taskforcesh/bullmq/issues/2813)(- [a384d92](https://github.com/taskforcesh/bullmq/commit/a384d926bee15bffa84178a8fad7b94a6a08b572))

[5.19.0](https://github.com/taskforcesh/bullmq/compare/v5.18.0...v5.19.0) (2024-10-11) [](https://docs.bullmq.io#_5-19-0-2024-10-11)

### Features [](https://docs.bullmq.io#features-62)

- **repeat:**deprecate immediately on job scheduler (- [ed047f7](https://github.com/taskforcesh/bullmq/commit/ed047f7ab69ebdb445343b6cb325e90b95ee9dc5))

[5.18.0](https://github.com/taskforcesh/bullmq/compare/v5.17.1...v5.18.0) (2024-10-09) [](https://docs.bullmq.io#_5-18-0-2024-10-09)

### Features [](https://docs.bullmq.io#features-63)

[5.17.1](https://github.com/taskforcesh/bullmq/compare/v5.17.0...v5.17.1) (2024-10-07) [](https://docs.bullmq.io#_5-17-1-2024-10-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-157)

- **repeat:**also consider startDate when using "every" (- [25bbaa8](https://github.com/taskforcesh/bullmq/commit/25bbaa81af87f9944a64bc4fb7e0c76ef223ada4))

[5.17.0](https://github.com/taskforcesh/bullmq/compare/v5.16.0...v5.17.0) (2024-10-07) [](https://docs.bullmq.io#_5-17-0-2024-10-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-158)

### Features [](https://docs.bullmq.io#features-64)

[5.16.0](https://github.com/taskforcesh/bullmq/compare/v5.15.0...v5.16.0) (2024-10-06) [](https://docs.bullmq.io#_5-16-0-2024-10-06)

### Features [](https://docs.bullmq.io#features-65)

- **queue:**add new upsertJobScheduler, getJobSchedulers and removeJobSchedulers methods (- [dd6b6b2](https://github.com/taskforcesh/bullmq/commit/dd6b6b2263badd8f29db65d1fa6bcdf5a1e9f6e2))

[5.15.0](https://github.com/taskforcesh/bullmq/compare/v5.14.0...v5.15.0) (2024-10-01) [](https://docs.bullmq.io#_5-15-0-2024-10-01)

### Features [](https://docs.bullmq.io#features-66)

[5.14.0](https://github.com/taskforcesh/bullmq/compare/v5.13.2...v5.14.0) (2024-09-30) [](https://docs.bullmq.io#_5-14-0-2024-09-30)

### Features [](https://docs.bullmq.io#features-67)

[5.13.2](https://github.com/taskforcesh/bullmq/compare/v5.13.1...v5.13.2) (2024-09-20) [](https://docs.bullmq.io#_5-13-2-2024-09-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-159)

[5.13.1](https://github.com/taskforcesh/bullmq/compare/v5.13.0...v5.13.1) (2024-09-18) [](https://docs.bullmq.io#_5-13-1-2024-09-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-160)

[5.13.0](https://github.com/taskforcesh/bullmq/compare/v5.12.15...v5.13.0) (2024-09-11) [](https://docs.bullmq.io#_5-13-0-2024-09-11)

### Features [](https://docs.bullmq.io#features-68)

[5.12.15](https://github.com/taskforcesh/bullmq/compare/v5.12.14...v5.12.15) (2024-09-10) [](https://docs.bullmq.io#_5-12-15-2024-09-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-161)

- **metrics:**differentiate points in different minutes to be more accurate (- [#2766](https://github.com/taskforcesh/bullmq/issues/2766)) (python) (- [7cb670e](https://github.com/taskforcesh/bullmq/commit/7cb670e1bf9560a24de3da52427b4f6b6152a59a))
- **pattern:**do not save offset when immediately is provided (- [#2756](https://github.com/taskforcesh/bullmq/issues/2756)) (- [a8cb8a2](https://github.com/taskforcesh/bullmq/commit/a8cb8a21ea52437ac507097994ef0fde058c5433))

[5.12.14](https://github.com/taskforcesh/bullmq/compare/v5.12.13...v5.12.14) (2024-09-05) [](https://docs.bullmq.io#_5-12-14-2024-09-05)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-20)

[5.12.13](https://github.com/taskforcesh/bullmq/compare/v5.12.12...v5.12.13) (2024-09-03) [](https://docs.bullmq.io#_5-12-13-2024-09-03)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-162)

- **repeat:**replace delayed job when updating repeat key (- [88029bb](https://github.com/taskforcesh/bullmq/commit/88029bbeab2a58768f9c438318f540010cd286a7))

[5.12.12](https://github.com/taskforcesh/bullmq/compare/v5.12.11...v5.12.12) (2024-08-29) [](https://docs.bullmq.io#_5-12-12-2024-08-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-163)

[5.12.11](https://github.com/taskforcesh/bullmq/compare/v5.12.10...v5.12.11) (2024-08-28) [](https://docs.bullmq.io#_5-12-11-2024-08-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-164)

[5.12.10](https://github.com/taskforcesh/bullmq/compare/v5.12.9...v5.12.10) (2024-08-22) [](https://docs.bullmq.io#_5-12-10-2024-08-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-165)

[5.12.9](https://github.com/taskforcesh/bullmq/compare/v5.12.8...v5.12.9) (2024-08-17) [](https://docs.bullmq.io#_5-12-9-2024-08-17)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-21)

[5.12.8](https://github.com/taskforcesh/bullmq/compare/v5.12.7...v5.12.8) (2024-08-17) [](https://docs.bullmq.io#_5-12-8-2024-08-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-166)

[5.12.7](https://github.com/taskforcesh/bullmq/compare/v5.12.6...v5.12.7) (2024-08-16) [](https://docs.bullmq.io#_5-12-7-2024-08-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-167)

- **job:**throw error if removeDependencyOnFailure and ignoreDependencyOnFailure are used together (- [#2711](https://github.com/taskforcesh/bullmq/issues/2711)) (- [967632c](https://github.com/taskforcesh/bullmq/commit/967632c9ef8468aab59f0b36d1d828bcde1fbd70))

[5.12.6](https://github.com/taskforcesh/bullmq/compare/v5.12.5...v5.12.6) (2024-08-14) [](https://docs.bullmq.io#_5-12-6-2024-08-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-168)

- **job:**change moveToFinished return type to reflect jobData (- [#2706](https://github.com/taskforcesh/bullmq/issues/2706)) ref- [#2342](https://github.com/taskforcesh/bullmq/issues/2342)(- [de094a3](https://github.com/taskforcesh/bullmq/commit/de094a361a25886acbee0112bb4341c6b285b1c9))
- **stalled:**support removeDependencyOnFailure option when job is stalled (- [#2708](https://github.com/taskforcesh/bullmq/issues/2708)) (- [e0d3790](https://github.com/taskforcesh/bullmq/commit/e0d3790e755c4dfe31006b52f177f08b40348e61))

[5.12.5](https://github.com/taskforcesh/bullmq/compare/v5.12.4...v5.12.5) (2024-08-13) [](https://docs.bullmq.io#_5-12-5-2024-08-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-169)

[5.12.4](https://github.com/taskforcesh/bullmq/compare/v5.12.3...v5.12.4) (2024-08-12) [](https://docs.bullmq.io#_5-12-4-2024-08-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-170)

[5.12.3](https://github.com/taskforcesh/bullmq/compare/v5.12.2...v5.12.3) (2024-08-10) [](https://docs.bullmq.io#_5-12-3-2024-08-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-171)

- **flow:**validate parentData before ignoreDependencyOnFailure when stalled check happens (- [#2702](https://github.com/taskforcesh/bullmq/issues/2702)) (python) (- [9416501](https://github.com/taskforcesh/bullmq/commit/9416501551b1ad464e59bdba1045a5a9955e2ea4))

[5.12.2](https://github.com/taskforcesh/bullmq/compare/v5.12.1...v5.12.2) (2024-08-09) [](https://docs.bullmq.io#_5-12-2-2024-08-09)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-22)

[5.12.1](https://github.com/taskforcesh/bullmq/compare/v5.12.0...v5.12.1) (2024-08-07) [](https://docs.bullmq.io#_5-12-1-2024-08-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-172)

[5.12.0](https://github.com/taskforcesh/bullmq/compare/v5.11.0...v5.12.0) (2024-08-01) [](https://docs.bullmq.io#_5-12-0-2024-08-01)

### Features [](https://docs.bullmq.io#features-69)

[5.11.0](https://github.com/taskforcesh/bullmq/compare/v5.10.4...v5.11.0) (2024-07-29) [](https://docs.bullmq.io#_5-11-0-2024-07-29)

### Features [](https://docs.bullmq.io#features-70)

[5.10.4](https://github.com/taskforcesh/bullmq/compare/v5.10.3...v5.10.4) (2024-07-26) [](https://docs.bullmq.io#_5-10-4-2024-07-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-173)

[5.10.3](https://github.com/taskforcesh/bullmq/compare/v5.10.2...v5.10.3) (2024-07-19) [](https://docs.bullmq.io#_5-10-3-2024-07-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-174)

- **repeatable:**keep legacy repeatables if it exists instead of creating one with new structure (- [#2665](https://github.com/taskforcesh/bullmq/issues/2665)) (- [93fad41](https://github.com/taskforcesh/bullmq/commit/93fad41a9520961d0e6814d82454bc916a039501))

[5.10.2](https://github.com/taskforcesh/bullmq/compare/v5.10.1...v5.10.2) (2024-07-19) [](https://docs.bullmq.io#_5-10-2-2024-07-19)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-23)

[5.10.1](https://github.com/taskforcesh/bullmq/compare/v5.10.0...v5.10.1) (2024-07-18) [](https://docs.bullmq.io#_5-10-1-2024-07-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-175)

- **repeatable:**consider removing legacy repeatable job (- [#2658](https://github.com/taskforcesh/bullmq/issues/2658)) fixes- [#2661](https://github.com/taskforcesh/bullmq/issues/2661)(- [a6764ae](https://github.com/taskforcesh/bullmq/commit/a6764aecb557fb918d061f5e5c2e26e4afa3e8ee))
- **repeatable:**pass custom key as an args in addRepeatableJob to prevent CROSSSLOT issue (- [#2662](https://github.com/taskforcesh/bullmq/issues/2662)) fixes- [#2660](https://github.com/taskforcesh/bullmq/issues/2660)(- [9d8f874](https://github.com/taskforcesh/bullmq/commit/9d8f874b959e09662985f38c4614b95ab4d5e89c))

[5.10.0](https://github.com/taskforcesh/bullmq/compare/v5.9.0...v5.10.0) (2024-07-16) [](https://docs.bullmq.io#_5-10-0-2024-07-16)

### Features [](https://docs.bullmq.io#features-71)

[5.9.0](https://github.com/taskforcesh/bullmq/compare/v5.8.7...v5.9.0) (2024-07-15) [](https://docs.bullmq.io#_5-9-0-2024-07-15)

### Features [](https://docs.bullmq.io#features-72)

[5.8.7](https://github.com/taskforcesh/bullmq/compare/v5.8.6...v5.8.7) (2024-07-11) [](https://docs.bullmq.io#_5-8-7-2024-07-11)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-24)

[5.8.6](https://github.com/taskforcesh/bullmq/compare/v5.8.5...v5.8.6) (2024-07-11) [](https://docs.bullmq.io#_5-8-6-2024-07-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-176)

[5.8.5](https://github.com/taskforcesh/bullmq/compare/v5.8.4...v5.8.5) (2024-07-10) [](https://docs.bullmq.io#_5-8-5-2024-07-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-177)

- **parent:**consider re-adding child that is in completed state using same jobIds (- [#2627](https://github.com/taskforcesh/bullmq/issues/2627)) (python) fixes- [#2554](https://github.com/taskforcesh/bullmq/issues/2554)(- [00cd017](https://github.com/taskforcesh/bullmq/commit/00cd0174539fbe1cc4628b9b6e1a7eb87a5ef705))

[5.8.4](https://github.com/taskforcesh/bullmq/compare/v5.8.3...v5.8.4) (2024-07-05) [](https://docs.bullmq.io#_5-8-4-2024-07-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-178)

[5.8.3](https://github.com/taskforcesh/bullmq/compare/v5.8.2...v5.8.3) (2024-06-28) [](https://docs.bullmq.io#_5-8-3-2024-06-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-179)

[5.8.2](https://github.com/taskforcesh/bullmq/compare/v5.8.1...v5.8.2) (2024-06-15) [](https://docs.bullmq.io#_5-8-2-2024-06-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-180)

[5.8.1](https://github.com/taskforcesh/bullmq/compare/v5.8.0...v5.8.1) (2024-06-12) [](https://docs.bullmq.io#_5-8-1-2024-06-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-181)

[5.8.0](https://github.com/taskforcesh/bullmq/compare/v5.7.15...v5.8.0) (2024-06-11) [](https://docs.bullmq.io#_5-8-0-2024-06-11)

### Features [](https://docs.bullmq.io#features-73)

[5.7.15](https://github.com/taskforcesh/bullmq/compare/v5.7.14...v5.7.15) (2024-06-04) [](https://docs.bullmq.io#_5-7-15-2024-06-04)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-25)

[5.7.14](https://github.com/taskforcesh/bullmq/compare/v5.7.13...v5.7.14) (2024-05-29) [](https://docs.bullmq.io#_5-7-14-2024-05-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-182)

- **worker:**properly cancel blocking command during disconnections (- [2cf12b3](https://github.com/taskforcesh/bullmq/commit/2cf12b3622b0517f645971ece8acdcf673bede97))

[5.7.13](https://github.com/taskforcesh/bullmq/compare/v5.7.12...v5.7.13) (2024-05-28) [](https://docs.bullmq.io#_5-7-13-2024-05-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-183)

[5.7.12](https://github.com/taskforcesh/bullmq/compare/v5.7.11...v5.7.12) (2024-05-24) [](https://docs.bullmq.io#_5-7-12-2024-05-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-184)

[5.7.11](https://github.com/taskforcesh/bullmq/compare/v5.7.10...v5.7.11) (2024-05-23) [](https://docs.bullmq.io#_5-7-11-2024-05-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-185)

[5.7.10](https://github.com/taskforcesh/bullmq/compare/v5.7.9...v5.7.10) (2024-05-21) [](https://docs.bullmq.io#_5-7-10-2024-05-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-186)

[5.7.9](https://github.com/taskforcesh/bullmq/compare/v5.7.8...v5.7.9) (2024-05-16) [](https://docs.bullmq.io#_5-7-9-2024-05-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-187)

[5.7.8](https://github.com/taskforcesh/bullmq/compare/v5.7.7...v5.7.8) (2024-05-01) [](https://docs.bullmq.io#_5-7-8-2024-05-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-188)

- **worker:**make sure clearTimeout is always called after bzpopmin (- [782382e](https://github.com/taskforcesh/bullmq/commit/782382e599218024bb9912ff0572c4aa9b1f22a3))

[5.7.7](https://github.com/taskforcesh/bullmq/compare/v5.7.6...v5.7.7) (2024-04-30) [](https://docs.bullmq.io#_5-7-7-2024-04-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-189)

[5.7.6](https://github.com/taskforcesh/bullmq/compare/v5.7.5...v5.7.6) (2024-04-27) [](https://docs.bullmq.io#_5-7-6-2024-04-27)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-26)

[5.7.5](https://github.com/taskforcesh/bullmq/compare/v5.7.4...v5.7.5) (2024-04-24) [](https://docs.bullmq.io#_5-7-5-2024-04-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-190)

[5.7.4](https://github.com/taskforcesh/bullmq/compare/v5.7.3...v5.7.4) (2024-04-21) [](https://docs.bullmq.io#_5-7-4-2024-04-21)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-27)

[5.7.3](https://github.com/taskforcesh/bullmq/compare/v5.7.2...v5.7.3) (2024-04-20) [](https://docs.bullmq.io#_5-7-3-2024-04-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-191)

[5.7.2](https://github.com/taskforcesh/bullmq/compare/v5.7.1...v5.7.2) (2024-04-18) [](https://docs.bullmq.io#_5-7-2-2024-04-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-192)

- **stalled:**consider failParentOnFailure when moving child into failed (- [#2526](https://github.com/taskforcesh/bullmq/issues/2526)) fixes- [#2464](https://github.com/taskforcesh/bullmq/issues/2464)(python) (- [5e31eb0](https://github.com/taskforcesh/bullmq/commit/5e31eb096169ea57350db591bcebfc2264a6b6dc))

[5.7.1](https://github.com/taskforcesh/bullmq/compare/v5.7.0...v5.7.1) (2024-04-10) [](https://docs.bullmq.io#_5-7-1-2024-04-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-193)

- **worker:**use 0.002 as minimum timeout for redis version lower than 7.0.8 (- [#2515](https://github.com/taskforcesh/bullmq/issues/2515)) fixes- [#2466](https://github.com/taskforcesh/bullmq/issues/2466)(- [44f7d21](https://github.com/taskforcesh/bullmq/commit/44f7d21850747d9c636c78e08b9e577d684fb885))

[5.7.0](https://github.com/taskforcesh/bullmq/compare/v5.6.0...v5.7.0) (2024-04-09) [](https://docs.bullmq.io#_5-7-0-2024-04-09)

### Features [](https://docs.bullmq.io#features-74)

- allow arbitrary large drainDelay ([9693321](https://github.com/taskforcesh/bullmq/commit/96933217bf79658e5bb23fd7afe47e0b1150a40d))

[5.6.0](https://github.com/taskforcesh/bullmq/compare/v5.5.4...v5.6.0) (2024-04-08) [](https://docs.bullmq.io#_5-6-0-2024-04-08)

### Features [](https://docs.bullmq.io#features-75)

- Nothing changed, triggered by a python version release

[5.5.4](https://github.com/taskforcesh/bullmq/compare/v5.5.3...v5.5.4) (2024-04-07) [](https://docs.bullmq.io#_5-5-4-2024-04-07)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-28)

- **stalled:**remove jobId from stalled after removing lock when moved from active (- [#2512](https://github.com/taskforcesh/bullmq/issues/2512)) (python) (- [64feec9](https://github.com/taskforcesh/bullmq/commit/64feec91b0b034fe640a846166bd95b546ff6d71))

[5.5.3](https://github.com/taskforcesh/bullmq/compare/v5.5.2...v5.5.3) (2024-04-07) [](https://docs.bullmq.io#_5-5-3-2024-04-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-194)

[5.5.2](https://github.com/taskforcesh/bullmq/compare/v5.5.1...v5.5.2) (2024-04-06) [](https://docs.bullmq.io#_5-5-2-2024-04-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-195)

[5.5.1](https://github.com/taskforcesh/bullmq/compare/v5.5.0...v5.5.1) (2024-04-03) [](https://docs.bullmq.io#_5-5-1-2024-04-03)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-196)

[5.5.0](https://github.com/taskforcesh/bullmq/compare/v5.4.6...v5.5.0) (2024-03-31) [](https://docs.bullmq.io#_5-5-0-2024-03-31)

### Features [](https://docs.bullmq.io#features-76)

- **getters:**add getWorkersCount (- [743c7aa](https://github.com/taskforcesh/bullmq/commit/743c7aa8f979760bc04f7b8f55844020559038e1))

[5.4.6](https://github.com/taskforcesh/bullmq/compare/v5.4.5...v5.4.6) (2024-03-26) [](https://docs.bullmq.io#_5-4-6-2024-03-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-197)

[5.4.5](https://github.com/taskforcesh/bullmq/compare/v5.4.4...v5.4.5) (2024-03-22) [](https://docs.bullmq.io#_5-4-5-2024-03-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-198)

[5.4.4](https://github.com/taskforcesh/bullmq/compare/v5.4.3...v5.4.4) (2024-03-21) [](https://docs.bullmq.io#_5-4-4-2024-03-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-199)

[5.4.3](https://github.com/taskforcesh/bullmq/compare/v5.4.2...v5.4.3) (2024-03-17) [](https://docs.bullmq.io#_5-4-3-2024-03-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-200)

[5.4.2](https://github.com/taskforcesh/bullmq/compare/v5.4.1...v5.4.2) (2024-03-06) [](https://docs.bullmq.io#_5-4-2-2024-03-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-201)

[5.4.1](https://github.com/taskforcesh/bullmq/compare/v5.4.0...v5.4.1) (2024-03-01) [](https://docs.bullmq.io#_5-4-1-2024-03-01)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-202)

- **worker:**set blockTimeout as 0.001 when reach the time to get delayed jobs (- [#2455](https://github.com/taskforcesh/bullmq/issues/2455)) fixes- [#2450](https://github.com/taskforcesh/bullmq/issues/2450)(- [2de15ca](https://github.com/taskforcesh/bullmq/commit/2de15ca1019517f7ce11f3734fff316a3e4ab894))

[5.4.0](https://github.com/taskforcesh/bullmq/compare/v5.3.3...v5.4.0) (2024-02-27) [](https://docs.bullmq.io#_5-4-0-2024-02-27)

### Features [](https://docs.bullmq.io#features-77)

[5.3.3](https://github.com/taskforcesh/bullmq/compare/v5.3.2...v5.3.3) (2024-02-25) [](https://docs.bullmq.io#_5-3-3-2024-02-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-203)

- **deps:**replaced glob by fast-glob due to security advisory (- [91cf9a9](https://github.com/taskforcesh/bullmq/commit/91cf9a9253370ea76df48c27a7e0fcf8d7504c81))

[5.3.2](https://github.com/taskforcesh/bullmq/compare/v5.3.1...v5.3.2) (2024-02-24) [](https://docs.bullmq.io#_5-3-2-2024-02-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-204)

[5.3.1](https://github.com/taskforcesh/bullmq/compare/v5.3.0...v5.3.1) (2024-02-22) [](https://docs.bullmq.io#_5-3-1-2024-02-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-205)

[5.3.0](https://github.com/taskforcesh/bullmq/compare/v5.2.1...v5.3.0) (2024-02-20) [](https://docs.bullmq.io#_5-3-0-2024-02-20)

### Features [](https://docs.bullmq.io#features-78)

- **worker:**add support for naming workers (- [7ba2729](https://github.com/taskforcesh/bullmq/commit/7ba27293615e443903cfdf7d0ff8be0052d061c4))

[5.2.1](https://github.com/taskforcesh/bullmq/compare/v5.2.0...v5.2.1) (2024-02-17) [](https://docs.bullmq.io#_5-2-1-2024-02-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-206)

[5.2.0](https://github.com/taskforcesh/bullmq/compare/v5.1.12...v5.2.0) (2024-02-17) [](https://docs.bullmq.io#_5-2-0-2024-02-17)

### Features [](https://docs.bullmq.io#features-79)

[5.1.12](https://github.com/taskforcesh/bullmq/compare/v5.1.11...v5.1.12) (2024-02-16) [](https://docs.bullmq.io#_5-1-12-2024-02-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-207)

[5.1.11](https://github.com/taskforcesh/bullmq/compare/v5.1.10...v5.1.11) (2024-02-13) [](https://docs.bullmq.io#_5-1-11-2024-02-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-208)

[5.1.10](https://github.com/taskforcesh/bullmq/compare/v5.1.9...v5.1.10) (2024-02-10) [](https://docs.bullmq.io#_5-1-10-2024-02-10)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-29)

[5.1.9](https://github.com/taskforcesh/bullmq/compare/v5.1.8...v5.1.9) (2024-02-05) [](https://docs.bullmq.io#_5-1-9-2024-02-05)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-30)

[5.1.8](https://github.com/taskforcesh/bullmq/compare/v5.1.7...v5.1.8) (2024-02-03) [](https://docs.bullmq.io#_5-1-8-2024-02-03)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-31)

[5.1.7](https://github.com/taskforcesh/bullmq/compare/v5.1.6...v5.1.7) (2024-02-02) [](https://docs.bullmq.io#_5-1-7-2024-02-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-209)

[5.1.6](https://github.com/taskforcesh/bullmq/compare/v5.1.5...v5.1.6) (2024-01-31) [](https://docs.bullmq.io#_5-1-6-2024-01-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-210)

[5.1.5](https://github.com/taskforcesh/bullmq/compare/v5.1.4...v5.1.5) (2024-01-23) [](https://docs.bullmq.io#_5-1-5-2024-01-23)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-32)

[5.1.4](https://github.com/taskforcesh/bullmq/compare/v5.1.3...v5.1.4) (2024-01-20) [](https://docs.bullmq.io#_5-1-4-2024-01-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-211)

[5.1.3](https://github.com/taskforcesh/bullmq/compare/v5.1.2...v5.1.3) (2024-01-16) [](https://docs.bullmq.io#_5-1-3-2024-01-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-212)

[5.1.2](https://github.com/taskforcesh/bullmq/compare/v5.1.1...v5.1.2) (2024-01-15) [](https://docs.bullmq.io#_5-1-2-2024-01-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-213)

- **security:**upgrade msgpackr- [https://github.com/advisories/GHSA-7hpj-7hhx-2fgx](https://github.com/advisories/GHSA-7hpj-7hhx-2fgx)(- [7ae0953](https://github.com/taskforcesh/bullmq/commit/7ae095357fddbdaacc286cbe5782946b95160d55))

[5.1.1](https://github.com/taskforcesh/bullmq/compare/v5.1.0...v5.1.1) (2024-01-02) [](https://docs.bullmq.io#_5-1-1-2024-01-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-214)

[5.1.0](https://github.com/taskforcesh/bullmq/compare/v5.0.0...v5.1.0) (2023-12-27) [](https://docs.bullmq.io#_5-1-0-2023-12-27)

### Features [](https://docs.bullmq.io#features-80)

[5.0.0](https://github.com/taskforcesh/bullmq/compare/v4.17.0...v5.0.0) (2023-12-21) [](https://docs.bullmq.io#_5-0-0-2023-12-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-215)

- **worker:**throw error if connection is missing (- [6491a18](https://github.com/taskforcesh/bullmq/commit/6491a185268ae546baa9b95a20b95d63c0e27915))

### Features [](https://docs.bullmq.io#features-81)

- **job:**provide skipAttempt option when manually moving a job (- [#2203](https://github.com/taskforcesh/bullmq/issues/2203)) (- [0e88e4f](https://github.com/taskforcesh/bullmq/commit/0e88e4fe4ed940487dfc79d1345d0686de22d0c6))
- **worker:**improved markers handling (- [73cf5fc](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) (- [0bac0fb](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))


---

## Changelogs Changelog-V4

Source URL: https://docs.bullmq.io/changelogs/changelog-v4

[4.18.3](https://github.com/taskforcesh/bullmq/compare/v4.18.2...v4.18.3) (2025-07-19) [](https://docs.bullmq.io#_4-18-3-2025-07-19)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements)

[4.18.2](https://github.com/taskforcesh/bullmq/compare/v4.18.1...v4.18.2) (2024-10-24) [](https://docs.bullmq.io#_4-18-2-2024-10-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes)

- proper way to get version ([1a433d2](https://github.com/taskforcesh/bullmq/commit/1a433d2a17b58ba8d30f0ecf52d9091f8377978f))

[4.18.1](https://github.com/taskforcesh/bullmq/compare/v4.18.0...v4.18.1) (2024-10-19) [](https://docs.bullmq.io#_4-18-1-2024-10-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-1)

- use versions for lua commands ([b0a216d](https://github.com/taskforcesh/bullmq/commit/b0a216deacb0295e77b039ea67c100e57b045037))

[4.18.0](https://github.com/taskforcesh/bullmq/compare/v4.17.0...v4.18.0) (2024-10-14) [](https://docs.bullmq.io#_4-18-0-2024-10-14)

### Features [](https://docs.bullmq.io#features)

- **queue:**add version support (- [a600463](https://github.com/taskforcesh/bullmq/commit/a6004639612118ce5adc2a87f0402386ba8e1c2f))

[4.17.0](https://github.com/taskforcesh/bullmq/compare/v4.16.0...v4.17.0) (2023-12-21) [](https://docs.bullmq.io#_4-17-0-2023-12-21)

### Features [](https://docs.bullmq.io#features-1)

- **sandbox:**support URL (local files) as processor file (- [7eea670](https://github.com/taskforcesh/bullmq/commit/7eea6700b33bfd7f36b030b647b819a4c5fd9606))

[4.16.0](https://github.com/taskforcesh/bullmq/compare/v4.15.4...v4.16.0) (2023-12-18) [](https://docs.bullmq.io#_4-16-0-2023-12-18)

### Features [](https://docs.bullmq.io#features-2)

[4.15.4](https://github.com/taskforcesh/bullmq/compare/v4.15.3...v4.15.4) (2023-12-14) [](https://docs.bullmq.io#_4-15-4-2023-12-14)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-2)

[4.15.3](https://github.com/taskforcesh/bullmq/compare/v4.15.2...v4.15.3) (2023-12-13) [](https://docs.bullmq.io#_4-15-3-2023-12-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-3)

- **sandboxed:**better compatibility with esbuild (- [8eaf955](https://github.com/taskforcesh/bullmq/commit/8eaf9550fe8b322df624893c507c55d2cce34b11))

[4.15.2](https://github.com/taskforcesh/bullmq/compare/v4.15.1...v4.15.2) (2023-12-07) [](https://docs.bullmq.io#_4-15-2-2023-12-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-4)

- **child-processor:**preserve dynamic imports in commonjs (- [d97a5e0](https://github.com/taskforcesh/bullmq/commit/d97a5e06816cff04d86facdb8d32b512f29c6fb9))

[4.15.1](https://github.com/taskforcesh/bullmq/compare/v4.15.0...v4.15.1) (2023-12-06) [](https://docs.bullmq.io#_4-15-1-2023-12-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-5)

- **flows:**add meta key to queues created with flows (- [272ec69](https://github.com/taskforcesh/bullmq/commit/272ec69557f601a138e1aaba739f7e7878d5344b))

[4.15.0](https://github.com/taskforcesh/bullmq/compare/v4.14.4...v4.15.0) (2023-12-05) [](https://docs.bullmq.io#_4-15-0-2023-12-05)

### Features [](https://docs.bullmq.io#features-3)

- **sandboxes:**use the more compatible dynamic import instead of require (- [6d2fe6e](https://github.com/taskforcesh/bullmq/commit/6d2fe6e7c0473b75aeb9a6d3080b0676f9521065))

[4.14.4](https://github.com/taskforcesh/bullmq/compare/v4.14.3...v4.14.4) (2023-11-28) [](https://docs.bullmq.io#_4-14-4-2023-11-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-6)

[4.14.3](https://github.com/taskforcesh/bullmq/compare/v4.14.2...v4.14.3) (2023-11-27) [](https://docs.bullmq.io#_4-14-3-2023-11-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-7)

- **update-progress:**remove old updateProgress script to prevent conflict (- [#2298](https://github.com/taskforcesh/bullmq/issues/2298)) (python) (- [e65b819](https://github.com/taskforcesh/bullmq/commit/e65b819101f8e0e8fdef8c51cfdf9a52f5e73f13))
- **worker:**get dirname by using module.filename (- [#2296](https://github.com/taskforcesh/bullmq/issues/2296)) fixes- [#2288](https://github.com/taskforcesh/bullmq/issues/2288)(- [6e4db5a](https://github.com/taskforcesh/bullmq/commit/6e4db5a3f3648c6a7e10991f2e18f3dab96fb1d7))

[4.14.2](https://github.com/taskforcesh/bullmq/compare/v4.14.1...v4.14.2) (2023-11-24) [](https://docs.bullmq.io#_4-14-2-2023-11-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-8)

- **worker:**should cap update progress events (- [2cab9e9](https://github.com/taskforcesh/bullmq/commit/2cab9e94f65c7bdd053e3fb5944bcda6e3ebaa39))

[4.14.1](https://github.com/taskforcesh/bullmq/compare/v4.14.0...v4.14.1) (2023-11-23) [](https://docs.bullmq.io#_4-14-1-2023-11-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-9)

[4.14.0](https://github.com/taskforcesh/bullmq/compare/v4.13.3...v4.14.0) (2023-11-18) [](https://docs.bullmq.io#_4-14-0-2023-11-18)

### Features [](https://docs.bullmq.io#features-4)

[4.13.3](https://github.com/taskforcesh/bullmq/compare/v4.13.2...v4.13.3) (2023-11-16) [](https://docs.bullmq.io#_4-13-3-2023-11-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-10)

[4.13.2](https://github.com/taskforcesh/bullmq/compare/v4.13.1...v4.13.2) (2023-11-09) [](https://docs.bullmq.io#_4-13-2-2023-11-09)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-11)

[4.13.1](https://github.com/taskforcesh/bullmq/compare/v4.13.0...v4.13.1) (2023-11-08) [](https://docs.bullmq.io#_4-13-1-2023-11-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-12)

- **connection:**better handling of attached listeners (- [02474ad](https://github.com/taskforcesh/bullmq/commit/02474ad59a7b340d7bb2a7415ae7a88e14200398))
- **connection:**move redis instance check to queue base (- [13a339a](https://github.com/taskforcesh/bullmq/commit/13a339a730f46ff22acdd4a046e0d9c4b7d88679))

[4.13.0](https://github.com/taskforcesh/bullmq/compare/v4.12.10...v4.13.0) (2023-11-05) [](https://docs.bullmq.io#_4-13-0-2023-11-05)

### Features [](https://docs.bullmq.io#features-5)

[4.12.10](https://github.com/taskforcesh/bullmq/compare/v4.12.9...v4.12.10) (2023-11-05) [](https://docs.bullmq.io#_4-12-10-2023-11-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-13)

[4.12.9](https://github.com/taskforcesh/bullmq/compare/v4.12.8...v4.12.9) (2023-11-05) [](https://docs.bullmq.io#_4-12-9-2023-11-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-14)

[4.12.8](https://github.com/taskforcesh/bullmq/compare/v4.12.7...v4.12.8) (2023-11-03) [](https://docs.bullmq.io#_4-12-8-2023-11-03)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-15)

[4.12.7](https://github.com/taskforcesh/bullmq/compare/v4.12.6...v4.12.7) (2023-10-29) [](https://docs.bullmq.io#_4-12-7-2023-10-29)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-1)

[4.12.6](https://github.com/taskforcesh/bullmq/compare/v4.12.5...v4.12.6) (2023-10-26) [](https://docs.bullmq.io#_4-12-6-2023-10-26)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-16)

[4.12.5](https://github.com/taskforcesh/bullmq/compare/v4.12.4...v4.12.5) (2023-10-18) [](https://docs.bullmq.io#_4-12-5-2023-10-18)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-2)

[4.12.4](https://github.com/taskforcesh/bullmq/compare/v4.12.3...v4.12.4) (2023-10-13) [](https://docs.bullmq.io#_4-12-4-2023-10-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-17)

[4.12.3](https://github.com/taskforcesh/bullmq/compare/v4.12.2...v4.12.3) (2023-10-10) [](https://docs.bullmq.io#_4-12-3-2023-10-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-18)

[4.12.2](https://github.com/taskforcesh/bullmq/compare/v4.12.1...v4.12.2) (2023-10-05) [](https://docs.bullmq.io#_4-12-2-2023-10-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-19)

[4.12.1](https://github.com/taskforcesh/bullmq/compare/v4.12.0...v4.12.1) (2023-10-04) [](https://docs.bullmq.io#_4-12-1-2023-10-04)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-20)

[4.12.0](https://github.com/taskforcesh/bullmq/compare/v4.11.4...v4.12.0) (2023-09-29) [](https://docs.bullmq.io#_4-12-0-2023-09-29)

### Features [](https://docs.bullmq.io#features-6)

[4.11.4](https://github.com/taskforcesh/bullmq/compare/v4.11.3...v4.11.4) (2023-09-22) [](https://docs.bullmq.io#_4-11-4-2023-09-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-21)

[4.11.3](https://github.com/taskforcesh/bullmq/compare/v4.11.2...v4.11.3) (2023-09-22) [](https://docs.bullmq.io#_4-11-3-2023-09-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-22)

[4.11.2](https://github.com/taskforcesh/bullmq/compare/v4.11.1...v4.11.2) (2023-09-20) [](https://docs.bullmq.io#_4-11-2-2023-09-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-23)

[4.11.1](https://github.com/taskforcesh/bullmq/compare/v4.11.0...v4.11.1) (2023-09-20) [](https://docs.bullmq.io#_4-11-1-2023-09-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-24)

[4.11.0](https://github.com/taskforcesh/bullmq/compare/v4.10.0...v4.11.0) (2023-09-16) [](https://docs.bullmq.io#_4-11-0-2023-09-16)

### Features [](https://docs.bullmq.io#features-7)

[4.10.0](https://github.com/taskforcesh/bullmq/compare/v4.9.0...v4.10.0) (2023-09-12) [](https://docs.bullmq.io#_4-10-0-2023-09-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-25)

- **move-to-finished:**consider addition of prioritized jobs when processing last active job (- [#2176](https://github.com/taskforcesh/bullmq/issues/2176)) (python) (- [4b01f35](https://github.com/taskforcesh/bullmq/commit/4b01f359c290cfc62ea74ff3ab0b43ccc6956a02))
- **remove:**change error message when job is locked (python) (- [#2175](https://github.com/taskforcesh/bullmq/issues/2175)) (- [2f5628f](https://github.com/taskforcesh/bullmq/commit/2f5628feffab66cdcc78abf4d7bb608bdcaa65bb))

[4.9.0](https://github.com/taskforcesh/bullmq/compare/v4.8.0...v4.9.0) (2023-09-05) [](https://docs.bullmq.io#_4-9-0-2023-09-05)

### Features [](https://docs.bullmq.io#features-8)

[4.8.0](https://github.com/taskforcesh/bullmq/compare/v4.7.4...v4.8.0) (2023-08-20) [](https://docs.bullmq.io#_4-8-0-2023-08-20)

### Features [](https://docs.bullmq.io#features-9)

[4.7.4](https://github.com/taskforcesh/bullmq/compare/v4.7.3...v4.7.4) (2023-08-19) [](https://docs.bullmq.io#_4-7-4-2023-08-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-26)

[4.7.3](https://github.com/taskforcesh/bullmq/compare/v4.7.2...v4.7.3) (2023-08-17) [](https://docs.bullmq.io#_4-7-3-2023-08-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-27)

- **worker:**abort rate-limit delay when closing worker (- [264a81c](https://github.com/taskforcesh/bullmq/commit/264a81ca5f4e4f88c361d507312324b5f6c3225c))

[4.7.2](https://github.com/taskforcesh/bullmq/compare/v4.7.1...v4.7.2) (2023-08-12) [](https://docs.bullmq.io#_4-7-2-2023-08-12)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-28)

[4.7.1](https://github.com/taskforcesh/bullmq/compare/v4.7.0...v4.7.1) (2023-08-10) [](https://docs.bullmq.io#_4-7-1-2023-08-10)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-3)

[4.7.0](https://github.com/taskforcesh/bullmq/compare/v4.6.3...v4.7.0) (2023-08-03) [](https://docs.bullmq.io#_4-7-0-2023-08-03)

### Features [](https://docs.bullmq.io#features-10)

[4.6.3](https://github.com/taskforcesh/bullmq/compare/v4.6.2...v4.6.3) (2023-07-28) [](https://docs.bullmq.io#_4-6-3-2023-07-28)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-4)

[4.6.2](https://github.com/taskforcesh/bullmq/compare/v4.6.0...v4.6.2) (2023-07-26) [](https://docs.bullmq.io#_4-6-2-2023-07-26)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-5)

[4.6.0](https://github.com/taskforcesh/bullmq/compare/v4.5.0...v4.6.0) (2023-07-19) [](https://docs.bullmq.io#_4-6-0-2023-07-19)

### Features [](https://docs.bullmq.io#features-11)

- **queue:**add promoteJobs to promote all delayed jobs (- [6074592](https://github.com/taskforcesh/bullmq/commit/6074592574256ec4b1c340126288e803e56b1a64))

[4.5.0](https://github.com/taskforcesh/bullmq/compare/v4.4.0...v4.5.0) (2023-07-18) [](https://docs.bullmq.io#_4-5-0-2023-07-18)

### Features [](https://docs.bullmq.io#features-12)

[4.4.0](https://github.com/taskforcesh/bullmq/compare/v4.3.0...v4.4.0) (2023-07-17) [](https://docs.bullmq.io#_4-4-0-2023-07-17)

### Features [](https://docs.bullmq.io#features-13)

[4.3.0](https://github.com/taskforcesh/bullmq/compare/v4.2.1...v4.3.0) (2023-07-14) [](https://docs.bullmq.io#_4-3-0-2023-07-14)

### Features [](https://docs.bullmq.io#features-14)

[4.2.1](https://github.com/taskforcesh/bullmq/compare/v4.2.0...v4.2.1) (2023-07-10) [](https://docs.bullmq.io#_4-2-1-2023-07-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-29)

[4.2.0](https://github.com/taskforcesh/bullmq/compare/v4.1.0...v4.2.0) (2023-07-03) [](https://docs.bullmq.io#_4-2-0-2023-07-03)

### Features [](https://docs.bullmq.io#features-15)

[4.1.0](https://github.com/taskforcesh/bullmq/compare/v4.0.0...v4.1.0) (2023-06-23) [](https://docs.bullmq.io#_4-1-0-2023-06-23)

### Features [](https://docs.bullmq.io#features-16)

[4.0.0](https://github.com/taskforcesh/bullmq/compare/v3.15.8...v4.0.0) (2023-06-21) [](https://docs.bullmq.io#_4-0-0-2023-06-21)

### Features [](https://docs.bullmq.io#features-17)

- **queue:**add removeDeprecatedPriorityKey method

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-6)

### BREAKING CHANGES [](https://docs.bullmq.io#breaking-changes)

- **priority:**priority is separeted in its own zset, no duplication needed
- **job:**change job method name update to updateData


---

## Changelogs Changelog-V3

Source URL: https://docs.bullmq.io/changelogs/changelog-v3

[3.15.8](https://github.com/taskforcesh/bullmq/compare/v3.15.7...v3.15.8) (2023-06-16) [](https://docs.bullmq.io#_3-15-8-2023-06-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes)

[3.15.7](https://github.com/taskforcesh/bullmq/compare/v3.15.6...v3.15.7) (2023-06-16) [](https://docs.bullmq.io#_3-15-7-2023-06-16)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-1)

[3.15.6](https://github.com/taskforcesh/bullmq/compare/v3.15.5...v3.15.6) (2023-06-13) [](https://docs.bullmq.io#_3-15-6-2023-06-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-2)

[3.15.5](https://github.com/taskforcesh/bullmq/compare/v3.15.4...v3.15.5) (2023-06-11) [](https://docs.bullmq.io#_3-15-5-2023-06-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-3)

[3.15.4](https://github.com/taskforcesh/bullmq/compare/v3.15.3...v3.15.4) (2023-06-08) [](https://docs.bullmq.io#_3-15-4-2023-06-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-4)

[3.15.3](https://github.com/taskforcesh/bullmq/compare/v3.15.2...v3.15.3) (2023-06-08) [](https://docs.bullmq.io#_3-15-3-2023-06-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-5)

[3.15.2](https://github.com/taskforcesh/bullmq/compare/v3.15.1...v3.15.2) (2023-06-06) [](https://docs.bullmq.io#_3-15-2-2023-06-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-6)

- **worker:**better worker client naming (- [c5f63af](https://github.com/taskforcesh/bullmq/commit/c5f63affe72f7b6616f4c5f3aafde858dcc0b200))

[3.15.1](https://github.com/taskforcesh/bullmq/compare/v3.15.0...v3.15.1) (2023-06-05) [](https://docs.bullmq.io#_3-15-1-2023-06-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-7)

[3.15.0](https://github.com/taskforcesh/bullmq/compare/v3.14.2...v3.15.0) (2023-05-31) [](https://docs.bullmq.io#_3-15-0-2023-05-31)

### Features [](https://docs.bullmq.io#features)

[3.14.2](https://github.com/taskforcesh/bullmq/compare/v3.14.1...v3.14.2) (2023-05-30) [](https://docs.bullmq.io#_3-14-2-2023-05-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-8)

[3.14.1](https://github.com/taskforcesh/bullmq/compare/v3.14.0...v3.14.1) (2023-05-27) [](https://docs.bullmq.io#_3-14-1-2023-05-27)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements)

[3.14.0](https://github.com/taskforcesh/bullmq/compare/v3.13.4...v3.14.0) (2023-05-22) [](https://docs.bullmq.io#_3-14-0-2023-05-22)

### Features [](https://docs.bullmq.io#features-1)

- **worker:**make extendLocks overridable (- [7b1386b](https://github.com/taskforcesh/bullmq/commit/7b1386bb823562d9666a1ad6e206e1deb63e57ec))

[3.13.4](https://github.com/taskforcesh/bullmq/compare/v3.13.3...v3.13.4) (2023-05-11) [](https://docs.bullmq.io#_3-13-4-2023-05-11)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-1)

[3.13.3](https://github.com/taskforcesh/bullmq/compare/v3.13.2...v3.13.3) (2023-05-10) [](https://docs.bullmq.io#_3-13-3-2023-05-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-9)

[3.13.2](https://github.com/taskforcesh/bullmq/compare/v3.13.1...v3.13.2) (2023-05-09) [](https://docs.bullmq.io#_3-13-2-2023-05-09)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-10)

[3.13.1](https://github.com/taskforcesh/bullmq/compare/v3.13.0...v3.13.1) (2023-05-07) [](https://docs.bullmq.io#_3-13-1-2023-05-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-11)

[3.13.0](https://github.com/taskforcesh/bullmq/compare/v3.12.1...v3.13.0) (2023-05-06) [](https://docs.bullmq.io#_3-13-0-2023-05-06)

### Features [](https://docs.bullmq.io#features-2)

- **worker:**add worker threads support (- [0820985](https://github.com/taskforcesh/bullmq/commit/0820985e073582fdf841affad38ecc7ab64691ec))

[3.12.1](https://github.com/taskforcesh/bullmq/compare/v3.12.0...v3.12.1) (2023-05-05) [](https://docs.bullmq.io#_3-12-1-2023-05-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-12)

[3.12.0](https://github.com/taskforcesh/bullmq/compare/v3.11.0...v3.12.0) (2023-04-20) [](https://docs.bullmq.io#_3-12-0-2023-04-20)

### Features [](https://docs.bullmq.io#features-3)

- upgrade ioredis to 5.3.2 ([375b1be](https://github.com/taskforcesh/bullmq/commit/375b1be52035e93c5fef6024e0d06aa723f602a9))

[3.11.0](https://github.com/taskforcesh/bullmq/compare/v3.10.4...v3.11.0) (2023-04-17) [](https://docs.bullmq.io#_3-11-0-2023-04-17)

### Features [](https://docs.bullmq.io#features-4)

- **upstash:**don't throw an error when detecting an upstash host (- [2e06bca](https://github.com/taskforcesh/bullmq/commit/2e06bca3615aafecd725d093045a510a67053fed))

[3.10.4](https://github.com/taskforcesh/bullmq/compare/v3.10.3...v3.10.4) (2023-04-05) [](https://docs.bullmq.io#_3-10-4-2023-04-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-13)

[3.10.3](https://github.com/taskforcesh/bullmq/compare/v3.10.2...v3.10.3) (2023-03-30) [](https://docs.bullmq.io#_3-10-3-2023-03-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-14)

[3.10.2](https://github.com/taskforcesh/bullmq/compare/v3.10.1...v3.10.2) (2023-03-22) [](https://docs.bullmq.io#_3-10-2-2023-03-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-15)

[3.10.1](https://github.com/taskforcesh/bullmq/compare/v3.10.0...v3.10.1) (2023-03-06) [](https://docs.bullmq.io#_3-10-1-2023-03-06)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-16)

[3.10.0](https://github.com/taskforcesh/bullmq/compare/v3.9.0...v3.10.0) (2023-03-02) [](https://docs.bullmq.io#_3-10-0-2023-03-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-17)

- **worker:**close lock extended timer (- [7995f18](https://github.com/taskforcesh/bullmq/commit/7995f18bb7712bd50d0fa3d17c4ab565b16ab379))
- **worker:**correct lock extender logic (- [6aa3569](https://github.com/taskforcesh/bullmq/commit/6aa3569db0fe0137790e61a4b5982d2b35ee5646))
- **worker:**start stalled check timer (- [4763be0](https://github.com/taskforcesh/bullmq/commit/4763be028b0c7b0460fd0804d4569c446a06ef4a))

### Features [](https://docs.bullmq.io#features-5)

- **worker:**replace Promise.race with efficient an async fifo (- [0d94e35](https://github.com/taskforcesh/bullmq/commit/0d94e35e805b09c3b4c7404b8a2eeb71a1aff5c4))
- **worker:**simplify lock extension to one call independent of concurrency (- [ebf1aeb](https://github.com/taskforcesh/bullmq/commit/ebf1aeb2400383d0ae90ab68aeb4822aea03ba44))

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-2)

- **scripts:**reuse keys array to avoid allocations (- [feac7b4](https://github.com/taskforcesh/bullmq/commit/feac7b4070a6a3720597af36c43d095e9ea37173))
- **worker:**improve worker memory consumption (- [4846cf1](https://github.com/taskforcesh/bullmq/commit/4846cf1fe3f9ea35f58a679c11706e1a7101c898))

[3.9.0](https://github.com/taskforcesh/bullmq/compare/v3.8.0...v3.9.0) (2023-02-25) [](https://docs.bullmq.io#_3-9-0-2023-02-25)

### Features [](https://docs.bullmq.io#features-6)

[3.8.0](https://github.com/taskforcesh/bullmq/compare/v3.7.2...v3.8.0) (2023-02-23) [](https://docs.bullmq.io#_3-8-0-2023-02-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-18)

- **worker:**run stalled check directly first time (- [f71ec03](https://github.com/taskforcesh/bullmq/commit/f71ec03111a22897cbf2fad39073185e4aeac6d6))

### Features [](https://docs.bullmq.io#features-7)

- **worker:**add a public method to run the stalled checker (- [3159266](https://github.com/taskforcesh/bullmq/commit/3159266ccb002d4fc71b7ee7ac63c465c536dbd1))
- **worker:**add support to disable stalled checks (- [49e860c](https://github.com/taskforcesh/bullmq/commit/49e860c6675853971e992c2945b445660504e3b2))

[3.7.2](https://github.com/taskforcesh/bullmq/compare/v3.7.1...v3.7.2) (2023-02-23) [](https://docs.bullmq.io#_3-7-2-2023-02-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-19)

[3.7.1](https://github.com/taskforcesh/bullmq/compare/v3.7.0...v3.7.1) (2023-02-22) [](https://docs.bullmq.io#_3-7-1-2023-02-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-20)

[3.7.0](https://github.com/taskforcesh/bullmq/compare/v3.6.6...v3.7.0) (2023-02-16) [](https://docs.bullmq.io#_3-7-0-2023-02-16)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-3)

[3.6.6](https://github.com/taskforcesh/bullmq/compare/v3.6.5...v3.6.6) (2023-02-15) [](https://docs.bullmq.io#_3-6-6-2023-02-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-21)

[3.6.5](https://github.com/taskforcesh/bullmq/compare/v3.6.4...v3.6.5) (2023-02-11) [](https://docs.bullmq.io#_3-6-5-2023-02-11)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-22)

- infinite worker process spawned for invalid JS file ([a445ba8](https://github.com/taskforcesh/bullmq/commit/a445ba8b7a261b370dec7d88091ae5f5af8b2728))

[3.6.4](https://github.com/taskforcesh/bullmq/compare/v3.6.3...v3.6.4) (2023-02-09) [](https://docs.bullmq.io#_3-6-4-2023-02-09)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-23)

- **worker:**add a maximum block time (- [1a2618b](https://github.com/taskforcesh/bullmq/commit/1a2618bc5473288a62dddb85e3cb78d6cdb4f39f))

[3.6.3](https://github.com/taskforcesh/bullmq/compare/v3.6.2...v3.6.3) (2023-02-07) [](https://docs.bullmq.io#_3-6-3-2023-02-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-24)

- **master:**copy type declaration (- [23ade6e](https://github.com/taskforcesh/bullmq/commit/23ade6e3e45df14bd3fbc2c3e7be47307b642872))

[3.6.2](https://github.com/taskforcesh/bullmq/compare/v3.6.1...v3.6.2) (2023-02-03) [](https://docs.bullmq.io#_3-6-2-2023-02-03)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-25)

- **redis:**increase minimum default retry time (- [d521531](https://github.com/taskforcesh/bullmq/commit/d521531e22ba9eda8ad8d6e8eddf450fdc3f50f4))

[3.6.1](https://github.com/taskforcesh/bullmq/compare/v3.6.0...v3.6.1) (2023-01-31) [](https://docs.bullmq.io#_3-6-1-2023-01-31)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-26)

- **connection:**apply console.warn in noeviction message (- [95f171c](https://github.com/taskforcesh/bullmq/commit/95f171cbc8cdd7d04865618b715dd21229f36a4a))

[3.6.0](https://github.com/taskforcesh/bullmq/compare/v3.5.11...v3.6.0) (2023-01-31) [](https://docs.bullmq.io#_3-6-0-2023-01-31)

### Features [](https://docs.bullmq.io#features-8)

[3.5.11](https://github.com/taskforcesh/bullmq/compare/v3.5.10...v3.5.11) (2023-01-27) [](https://docs.bullmq.io#_3-5-11-2023-01-27)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-27)

[3.5.10](https://github.com/taskforcesh/bullmq/compare/v3.5.9...v3.5.10) (2023-01-24) [](https://docs.bullmq.io#_3-5-10-2023-01-24)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-28)

[3.5.9](https://github.com/taskforcesh/bullmq/compare/v3.5.8...v3.5.9) (2023-01-19) [](https://docs.bullmq.io#_3-5-9-2023-01-19)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-29)

[3.5.8](https://github.com/taskforcesh/bullmq/compare/v3.5.7...v3.5.8) (2023-01-18) [](https://docs.bullmq.io#_3-5-8-2023-01-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-30)

[3.5.7](https://github.com/taskforcesh/bullmq/compare/v3.5.6...v3.5.7) (2023-01-17) [](https://docs.bullmq.io#_3-5-7-2023-01-17)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-31)

[3.5.6](https://github.com/taskforcesh/bullmq/compare/v3.5.5...v3.5.6) (2023-01-13) [](https://docs.bullmq.io#_3-5-6-2023-01-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-32)

[3.5.5](https://github.com/taskforcesh/bullmq/compare/v3.5.4...v3.5.5) (2023-01-10) [](https://docs.bullmq.io#_3-5-5-2023-01-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-33)

[3.5.4](https://github.com/taskforcesh/bullmq/compare/v3.5.3...v3.5.4) (2023-01-09) [](https://docs.bullmq.io#_3-5-4-2023-01-09)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-34)

[3.5.3](https://github.com/taskforcesh/bullmq/compare/v3.5.2...v3.5.3) (2023-01-07) [](https://docs.bullmq.io#_3-5-3-2023-01-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-35)

[3.5.2](https://github.com/taskforcesh/bullmq/compare/v3.5.1...v3.5.2) (2023-01-04) [](https://docs.bullmq.io#_3-5-2-2023-01-04)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-4)

[3.5.1](https://github.com/taskforcesh/bullmq/compare/v3.5.0...v3.5.1) (2022-12-23) [](https://docs.bullmq.io#_3-5-1-2022-12-23)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-36)

- **connection:**throw exception if using keyPrefix in ioredis (- [eb6a130](https://github.com/taskforcesh/bullmq/commit/eb6a1305541547725e1717eefe2b678bc445f4d0))
- **connection:**use includes to check for upstash more reliably (- [12efb5c](https://github.com/taskforcesh/bullmq/commit/12efb5c539cb6f031ea6f3a80e4128d2e556e627))

[3.5.0](https://github.com/taskforcesh/bullmq/compare/v3.4.2...v3.5.0) (2022-12-20) [](https://docs.bullmq.io#_3-5-0-2022-12-20)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-37)

- **job:**fetch parent before job moves to complete (- [#1580](https://github.com/taskforcesh/bullmq/issues/1580)) (- [6a6c0dc](https://github.com/taskforcesh/bullmq/commit/6a6c0dca30bb0a2417e0c62d4c80202c750322dd))
- **sandbox:**throw error when no exported function (- [#1588](https://github.com/taskforcesh/bullmq/issues/1588)) fixes- [#1587](https://github.com/taskforcesh/bullmq/issues/1587)(- [c031891](https://github.com/taskforcesh/bullmq/commit/c03189184c8eeeb324f005b86e93d114abbe2154))

### Features [](https://docs.bullmq.io#features-9)

[3.4.2](https://github.com/taskforcesh/bullmq/compare/v3.4.1...v3.4.2) (2022-12-15) [](https://docs.bullmq.io#_3-4-2-2022-12-15)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-5)

- **counts:**delete delayed marker when needed (- [#1583](https://github.com/taskforcesh/bullmq/issues/1583)) (- [cc26f1c](https://github.com/taskforcesh/bullmq/commit/cc26f1cd550de76c7588d3a98187b80ee78c40c4))
- **get-children-values:**replace slow object destructuring with single object (- [#1586](https://github.com/taskforcesh/bullmq/issues/1586)) (- [857d403](https://github.com/taskforcesh/bullmq/commit/857d40377a6eb2c0101e6d16d9085ecd4b52b016))

[3.4.1](https://github.com/taskforcesh/bullmq/compare/v3.4.0...v3.4.1) (2022-12-10) [](https://docs.bullmq.io#_3-4-1-2022-12-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-38)

- **exponential:**respect exponential backoff delay (- [#1581](https://github.com/taskforcesh/bullmq/issues/1581)) (- [145dd32](https://github.com/taskforcesh/bullmq/commit/145dd329bb9f8254b404f4c5fbf7a50359202d37))
- **get-jobs:**filter marker (- [#1551](https://github.com/taskforcesh/bullmq/issues/1551)) (- [4add0ef](https://github.com/taskforcesh/bullmq/commit/4add0efa7857cc2f7b6d3c0c78a7f82cb7a46933))

[3.4.0](https://github.com/taskforcesh/bullmq/compare/v3.3.5...v3.4.0) (2022-12-09) [](https://docs.bullmq.io#_3-4-0-2022-12-09)

### Features [](https://docs.bullmq.io#features-10)

[3.3.5](https://github.com/taskforcesh/bullmq/compare/v3.3.4...v3.3.5) (2022-12-08) [](https://docs.bullmq.io#_3-3-5-2022-12-08)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-39)

[3.3.4](https://github.com/taskforcesh/bullmq/compare/v3.3.3...v3.3.4) (2022-12-07) [](https://docs.bullmq.io#_3-3-4-2022-12-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-40)

[3.3.3](https://github.com/taskforcesh/bullmq/compare/v3.3.2...v3.3.3) (2022-12-07) [](https://docs.bullmq.io#_3-3-3-2022-12-07)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-41)

- do not allow move from active to wait if not owner of the job ([dc1a307](https://github.com/taskforcesh/bullmq/commit/dc1a3077d1521c5dc99824a7fc05d17da03906bc))

[3.3.2](https://github.com/taskforcesh/bullmq/compare/v3.3.1...v3.3.2) (2022-12-05) [](https://docs.bullmq.io#_3-3-2-2022-12-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-42)

- floor pexpire to integer ([1d5de42](https://github.com/taskforcesh/bullmq/commit/1d5de425a19ebf879a8f9a7e0543d87a4d358be1))

[3.3.1](https://github.com/taskforcesh/bullmq/compare/v3.3.0...v3.3.1) (2022-12-05) [](https://docs.bullmq.io#_3-3-1-2022-12-05)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-43)

- **get-workers:**set name when ready event in connection (- [#1564](https://github.com/taskforcesh/bullmq/issues/1564)) (- [de93c17](https://github.com/taskforcesh/bullmq/commit/de93c172901650e1666c48423a39076f2c7b9c7b))
- **job:**console warn custom job ids when they represent integers (- [#1569](https://github.com/taskforcesh/bullmq/issues/1569)) (- [6e677d2](https://github.com/taskforcesh/bullmq/commit/6e677d2800957b368bef4247b8e4328c5758f262))

[3.3.0](https://github.com/taskforcesh/bullmq/compare/v3.2.5...v3.3.0) (2022-12-04) [](https://docs.bullmq.io#_3-3-0-2022-12-04)

### Features [](https://docs.bullmq.io#features-11)

[3.2.5](https://github.com/taskforcesh/bullmq/compare/v3.2.4...v3.2.5) (2022-12-04) [](https://docs.bullmq.io#_3-2-5-2022-12-04)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-44)

[3.2.4](https://github.com/taskforcesh/bullmq/compare/v3.2.3...v3.2.4) (2022-11-29) [](https://docs.bullmq.io#_3-2-4-2022-11-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-45)

[3.2.3](https://github.com/taskforcesh/bullmq/compare/v3.2.2...v3.2.3) (2022-11-29) [](https://docs.bullmq.io#_3-2-3-2022-11-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-46)

[3.2.2](https://github.com/taskforcesh/bullmq/compare/v3.2.1...v3.2.2) (2022-11-15) [](https://docs.bullmq.io#_3-2-2-2022-11-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-47)

- **rate-limit:**check job is active before moving to wait (- [9502167](https://github.com/taskforcesh/bullmq/commit/9502167bb0d9008fc8811ff7980dc8126fbc5ac2))

[3.2.1](https://github.com/taskforcesh/bullmq/compare/v3.2.0...v3.2.1) (2022-11-15) [](https://docs.bullmq.io#_3-2-1-2022-11-15)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-48)

[3.2.0](https://github.com/taskforcesh/bullmq/compare/v3.1.3...v3.2.0) (2022-11-09) [](https://docs.bullmq.io#_3-2-0-2022-11-09)

### Features [](https://docs.bullmq.io#features-12)

[3.1.3](https://github.com/taskforcesh/bullmq/compare/v3.1.2...v3.1.3) (2022-11-04) [](https://docs.bullmq.io#_3-1-3-2022-11-04)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-49)

- **delayed:**better handling of marker id (- [816376e](https://github.com/taskforcesh/bullmq/commit/816376e7880ae0eafe85a1f9a5aef9fdfe3031a9))
- **delayed:**notify workers a delayed job is closer in time fixes- [#1505](https://github.com/taskforcesh/bullmq/issues/1505)(- [6ced4d0](https://github.com/taskforcesh/bullmq/commit/6ced4d06c5c9c8342c9e4f7920a21826871eac1b))
- **job:**better error message in moveToFailed (- [4e9f5bb](https://github.com/taskforcesh/bullmq/commit/4e9f5bb90f87c66eca959ffc9b7a09e05908c2d9))
- **moveToFinish:**always promote delayed jobs (- [7610cc3](https://github.com/taskforcesh/bullmq/commit/7610cc37d4695a885043c251990e153d4ce4440f))
- **moveToFinished:**revert move promoteDelayedJobs (- [7d780db](https://github.com/taskforcesh/bullmq/commit/7d780dbc1d7728ab7b762a5578871b31f27ff80c))

[3.1.2](https://github.com/taskforcesh/bullmq/compare/v3.1.1...v3.1.2) (2022-11-04) [](https://docs.bullmq.io#_3-1-2-2022-11-04)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-50)

- **repeat:**allow easy migration from bullmq ❤️ to >=3 (- [e17b886](https://github.com/taskforcesh/bullmq/commit/e17b886d3e2978e25f23f1a99b88562537a08576))

[3.1.1](https://github.com/taskforcesh/bullmq/compare/v3.1.0...v3.1.1) (2022-11-03) [](https://docs.bullmq.io#_3-1-1-2022-11-03)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-51)

- **change-delay:**remove delayed stream (- [#1509](https://github.com/taskforcesh/bullmq/issues/1509)) (- [6e4809e](https://github.com/taskforcesh/bullmq/commit/6e4809e5d8f7ef35bc0871d21bfcdcb0f1f316c6))
- **worker:**restore dynamic concurrency change (- [#1515](https://github.com/taskforcesh/bullmq/issues/1515)) (- [fdac5c2](https://github.com/taskforcesh/bullmq/commit/fdac5c27607dfaaaad1c1256c47f2ae448efcd21))

[3.1.0](https://github.com/taskforcesh/bullmq/compare/v3.0.1...v3.1.0) (2022-11-02) [](https://docs.bullmq.io#_3-1-0-2022-11-02)

### Features [](https://docs.bullmq.io#features-13)

- **workers:**better error message for missing lock (- [bf1d086](https://github.com/taskforcesh/bullmq/commit/bf1d0860c70bcc2b604d02ca47e5db64f962d71d))

[3.0.1](https://github.com/taskforcesh/bullmq/compare/v3.0.0...v3.0.1) (2022-11-02) [](https://docs.bullmq.io#_3-0-1-2022-11-02)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-52)

- **move-to-delayed:**consider promoting delayed jobs (- [#1493](https://github.com/taskforcesh/bullmq/issues/1493)) (- [909da2b](https://github.com/taskforcesh/bullmq/commit/909da2bc2718a588379b3fdd9791bc8e51ad1dad))
- **retry-job:**consider promoting delayed jobs (- [#1508](https://github.com/taskforcesh/bullmq/issues/1508)) (- [d0b3412](https://github.com/taskforcesh/bullmq/commit/d0b3412d222449c24ab36068a791d08ea19ed922))

[3.0.0](https://github.com/taskforcesh/bullmq/compare/v2.4.0...v3.0.0) (2022-10-25) [](https://docs.bullmq.io#_3-0-0-2022-10-25)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-53)

- **backoff:**handle backoff strategy as function (- [#1463](https://github.com/taskforcesh/bullmq/issues/1463)) (- [3640269](https://github.com/taskforcesh/bullmq/commit/36402691a3c7fa500f07e2e11a28318099bdb909))
- **repeat:**remove cron in favor of pattern option (- [#1456](https://github.com/taskforcesh/bullmq/issues/1456)) (- [3cc150e](https://github.com/taskforcesh/bullmq/commit/3cc150e32cb5971ad4ba6ff91246aaf75296c165))

### Features [](https://docs.bullmq.io#features-14)

- add support for dynamic rate limiting ([2d51d2b](https://github.com/taskforcesh/bullmq/commit/2d51d2b33ef49059503e1bca7a582c71f6861ef4))
- **rate-limit:**remove group key support and improve global rate limit (- [81f780a](https://github.com/taskforcesh/bullmq/commit/81f780aeed81e670107d01d01265d407a30e2a62))

### BREAKING CHANGES [](https://docs.bullmq.io#breaking-changes)

- **rate-limit:**limit by group keys has been removed in favor of a much simpler and efficent rate-limit implementation.
- **backoff:**object mapping is replaced by single function


---

## Changelogs Changelog-V2

Source URL: https://docs.bullmq.io/changelogs/changelog-v2

[2.4.0](https://github.com/taskforcesh/bullmq/compare/v2.3.2...v2.4.0) (2022-10-24) [](https://docs.bullmq.io#_2-4-0-2022-10-24)

### Features [](https://docs.bullmq.io#features)

[2.3.2](https://github.com/taskforcesh/bullmq/compare/v2.3.1...v2.3.2) (2022-10-18) [](https://docs.bullmq.io#_2-3-2-2022-10-18)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes)

[2.3.1](https://github.com/taskforcesh/bullmq/compare/v2.3.0...v2.3.1) (2022-10-13) [](https://docs.bullmq.io#_2-3-1-2022-10-13)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-1)

- **redis:**replace throw exception by console.error (- [fafa2f8](https://github.com/taskforcesh/bullmq/commit/fafa2f89e796796f950e6c4abbdda4d3d71ad1b0))

[2.3.0](https://github.com/taskforcesh/bullmq/compare/v2.2.1...v2.3.0) (2022-10-13) [](https://docs.bullmq.io#_2-3-0-2022-10-13)

### Features [](https://docs.bullmq.io#features-1)

[2.2.1](https://github.com/taskforcesh/bullmq/compare/v2.2.0...v2.2.1) (2022-10-11) [](https://docs.bullmq.io#_2-2-1-2022-10-11)

### Performance Improvements [](https://docs.bullmq.io#performance-improvements)

[2.2.0](https://github.com/taskforcesh/bullmq/compare/v2.1.3...v2.2.0) (2022-10-10) [](https://docs.bullmq.io#_2-2-0-2022-10-10)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-2)

### Features [](https://docs.bullmq.io#features-2)

[2.1.3](https://github.com/taskforcesh/bullmq/compare/v2.1.2...v2.1.3) (2022-09-30) [](https://docs.bullmq.io#_2-1-3-2022-09-30)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-3)

- **worker:**clear stalled jobs timer when closing worker (- [1567a0d](https://github.com/taskforcesh/bullmq/commit/1567a0df0ca3c8d43a18990fe488888f4ff68040))

[2.1.2](https://github.com/taskforcesh/bullmq/compare/v2.1.1...v2.1.2) (2022-09-29) [](https://docs.bullmq.io#_2-1-2-2022-09-29)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-4)

- **getters:**fix return type of getJobLogs (- [d452927](https://github.com/taskforcesh/bullmq/commit/d4529278c59b2c94eee604c7d4455acc490679e9))

[2.1.1](https://github.com/taskforcesh/bullmq/compare/v2.1.0...v2.1.1) (2022-09-28) [](https://docs.bullmq.io#_2-1-1-2022-09-28)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-5)

[2.1.0](https://github.com/taskforcesh/bullmq/compare/v2.0.2...v2.1.0) (2022-09-23) [](https://docs.bullmq.io#_2-1-0-2022-09-23)

### Features [](https://docs.bullmq.io#features-3)

[2.0.2](https://github.com/taskforcesh/bullmq/compare/v2.0.1...v2.0.2) (2022-09-22) [](https://docs.bullmq.io#_2-0-2-2022-09-22)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-6)

[2.0.1](https://github.com/taskforcesh/bullmq/compare/v2.0.0...v2.0.1) (2022-09-21) [](https://docs.bullmq.io#_2-0-1-2022-09-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-7)

- **connection:**throw error when no noeviction policy (- [3468390](https://github.com/taskforcesh/bullmq/commit/3468390dd6331291f4cf71a54c32028a06d1d99e))

### Performance Improvements [](https://docs.bullmq.io#performance-improvements-1)

- **events:**remove data and opts from added event (- [e13d4b8](https://github.com/taskforcesh/bullmq/commit/e13d4b8e0c4f99203f4249ccc86e369d124ff483))

[2.0.0](https://github.com/taskforcesh/bullmq/compare/v1.91.1...v2.0.0) (2022-09-21) [](https://docs.bullmq.io#_2-0-0-2022-09-21)

### Bug Fixes [](https://docs.bullmq.io#bug-fixes-8)

- **compat:**remove Queue3 class (- [#1421](https://github.com/taskforcesh/bullmq/issues/1421)) (- [fc797f7](https://github.com/taskforcesh/bullmq/commit/fc797f7cd334c19a95cb1290ddb6611cd3417179))
- **delayed:**promote delayed jobs instead of picking one by one (- [1b938af](https://github.com/taskforcesh/bullmq/commit/1b938af75069d69772ddf2b03f95db7f53eada68))
- **delayed:**remove marker when promoting delayed job (- [1aea0dc](https://github.com/taskforcesh/bullmq/commit/1aea0dcc5fb29086cef3d0c432c387d6f8261963))
- **getters:**compensate for "mark" job id (- [231b9aa](https://github.com/taskforcesh/bullmq/commit/231b9aa0f4781e4493d3ea272c33b27c0b7dc0ab))
- **sandbox:**remove progress method (- [b43267b](https://github.com/taskforcesh/bullmq/commit/b43267be50f9eade8233500d189d46940a01cc29))
- **stalled-jobs:**handle job id 0 (- [829e6e0](https://github.com/taskforcesh/bullmq/commit/829e6e0252e78bf2cbc55ab1d3bd153faa0cee4c))
- **worker:**do not allow stalledInterval to be less than zero (- [831ffc5](https://github.com/taskforcesh/bullmq/commit/831ffc520ccd3c6ea63af6b04ddddc9f7829c667))
- **workers:**use connection closing to determine closing status (- [fe1d173](https://github.com/taskforcesh/bullmq/commit/fe1d17321f1eb49bd872c52965392add22729941))

### Features [](https://docs.bullmq.io#features-4)

- improve delayed jobs and remove QueueScheduler ([1f66e5a](https://github.com/taskforcesh/bullmq/commit/1f66e5a6c891d52e0671e58a685dbca511e45e7e))
- move stalled jobs check and handling to Worker class from QueueScheduler ([13769cb](https://github.com/taskforcesh/bullmq/commit/13769cbe38ba22793cbc66e9706a6be28a7f1512))

### BREAKING CHANGES [](https://docs.bullmq.io#breaking-changes)

- **compat:**The compatibility class for Bullv3 is no longer available.
- The QueueScheduler class is removed since it is not necessary anymore. Delayed jobs are now handled in a much simpler and robust way, without the need of a separate process.
- Failed and stalled events are now produced by the Worker class instead of by the QueueScheduler.
- The minimum Redis recommended version is 6.2.0.
