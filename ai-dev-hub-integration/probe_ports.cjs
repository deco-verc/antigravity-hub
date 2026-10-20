const https = require('https');
const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 2108,
  path: '/',
  method: 'GET',
  rejectUnauthorized: false
};

const req = https.request(options, (res) => {
  console.log('HTTPS STATUS:', res.statusCode);
  res.on('data', (d) => console.log('HTTPS BODY:', d.toString()));
});
req.on('error', (e) => {
  console.log('HTTPS ERROR:', e.message);
  // try http
  const req2 = http.request({ ...options, port: 2109 }, (res2) => {
    console.log('HTTP 2109 STATUS:', res2.statusCode);
  });
  req2.on('error', (e2) => console.log('HTTP 2109 ERROR:', e2.message));
  req2.end();
});
req.end();
