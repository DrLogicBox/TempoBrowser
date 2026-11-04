const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const projectRoot = path.resolve(__dirname, '../..');

function startTimeStudyServer({ outputDirectory, port = 0, mediaFile } = {}) {
  const output = path.resolve(outputDirectory || path.join(projectRoot, 'test-results/time-study/manual'));
  if (!output.startsWith(projectRoot + path.sep)) {
    throw new Error('Test output must stay inside the project');
  }
  fs.mkdirSync(output, { recursive: true });
  const requestsFile = path.join(output, 'requests.jsonl');
  const recordsFile = path.join(output, 'backend.jsonl');
  const runs = new Map();
  let requestNumber = 0;

  function append(filename, record) {
    fs.appendFileSync(filename, JSON.stringify(record) + '\n');
  }

  function json(response, statusCode, body) {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(body));
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/media.webm' && mediaFile) {
      const size = fs.statSync(mediaFile).size;
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      response.writeHead(range ? 206 : 200, {
        'Content-Type': 'video/webm',
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
      });
      fs.createReadStream(mediaFile, { start, end }).pipe(response);
      return;
    }
    const assets = new Map([
      ['/', ['page.html', 'text/html; charset=utf-8']],
      ['/page.js', ['page.js', 'text/javascript; charset=utf-8']],
      ['/page.css', ['page.css', 'text/css; charset=utf-8']]
    ]);
    if (request.method === 'GET' && assets.has(url.pathname)) {
      const [filename, contentType] = assets.get(url.pathname);
      response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'"
      });
      response.end(fs.readFileSync(path.join(__dirname, filename)));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/results') {
      const run = runs.get(url.searchParams.get('runId'));
      json(response, run ? 200 : 404, run || { error: 'Unknown run' });
      return;
    }
    if (request.method !== 'POST' || !['/api/start', '/api/report'].includes(url.pathname)) {
      json(response, 404, { error: 'Unknown endpoint' });
      return;
    }

    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65536) throw new Error('Request body exceeds the local test limit');
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);
      const receivedMonotonic = process.hrtime.bigint();
      const receivedUnixMs = Date.now();
      const requestId = ++requestNumber;
      append(requestsFile, {
        requestId,
        method: request.method,
        url: request.url,
        httpVersion: request.httpVersion,
        rawHeaders: request.rawHeaders,
        remoteAddress: request.socket.remoteAddress,
        receivedAt: new Date(receivedUnixMs).toISOString(),
        receivedUnixMs,
        receivedMonotonicNs: receivedMonotonic.toString(),
        rawBody: rawBody.toString('utf8'),
        rawBodyBase64: rawBody.toString('base64')
      });
      const body = JSON.parse(rawBody.toString('utf8'));
      if (url.pathname === '/api/start') {
        if (!['client', 'server'].includes(body.rule)) {
          json(response, 400, { error: 'Invalid adoption rule' });
          return;
        }
        const run = {
          runId: randomUUID(),
          rule: body.rule,
          startedUnixMs: receivedUnixMs,
          startedMonotonicNs: receivedMonotonic.toString(),
          lastReceivedMonotonicNs: receivedMonotonic.toString(),
          lastSequence: 0,
          records: [],
          finalized: false
        };
        runs.set(run.runId, run);
        const startRecord = {
          event: 'start', requestId, runId: run.runId, rule: run.rule,
          receivedUnixMs, receivedAt: new Date(receivedUnixMs).toISOString(),
          receivedMonotonicNs: receivedMonotonic.toString()
        };
        append(recordsFile, startRecord);
        json(response, 201, startRecord);
        return;
      }

      const run = runs.get(body.runId);
      if (!run || run.finalized || body.sequence !== run.lastSequence + 1) {
        json(response, 409, { error: 'Unknown, finalized, or out-of-order run' });
        return;
      }
      const measurements = body.measurements;
      if (!measurements || !Number.isFinite(measurements.elapsedPerformanceMs) ||
          measurements.elapsedPerformanceMs < 0 || !['periodic', 'final'].includes(body.kind)) {
        json(response, 400, { error: 'Invalid report' });
        return;
      }
      const clientReportedSeconds = measurements.elapsedPerformanceMs / 1000;
      const serverIndependentSeconds = Number(receivedMonotonic - BigInt(run.startedMonotonicNs)) / 1e9;
      const record = {
        event: body.kind,
        requestId,
        runId: run.runId,
        rule: run.rule,
        sequence: body.sequence,
        receivedAt: new Date(receivedUnixMs).toISOString(),
        receivedUnixMs,
        receivedMonotonicNs: receivedMonotonic.toString(),
        serverIndependentSeconds,
        serverWallSeconds: (receivedUnixMs - run.startedUnixMs) / 1000,
        arrivalIntervalSeconds: Number(receivedMonotonic - BigInt(run.lastReceivedMonotonicNs)) / 1e9,
        clientReportedSeconds,
        adoptedSeconds: run.rule === 'client' ? clientReportedSeconds : serverIndependentSeconds,
        measurements
      };
      run.lastSequence = body.sequence;
      run.lastReceivedMonotonicNs = receivedMonotonic.toString();
      run.finalized = body.kind === 'final';
      run.records.push(record);
      append(recordsFile, record);
      json(response, 200, record);
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, runs, requestsFile, recordsFile });
    });
  });
}

module.exports = { startTimeStudyServer };

if (require.main === module) {
  const portArgument = process.argv.find(value => value.startsWith('--port='));
  const outputArgument = process.argv.find(value => value.startsWith('--output='));
  startTimeStudyServer({
    port: portArgument ? Number(portArgument.slice(7)) : 8765,
    outputDirectory: outputArgument ? outputArgument.slice(9) : undefined
  }).then(({ url, requestsFile, recordsFile }) => {
    console.log(JSON.stringify({ url, requestsFile, recordsFile }));
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
