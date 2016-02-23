var http = require('http');
var net = require('net');
var url = require('url');
var fs = require('fs');
var util = require('util');
var formidable = require("formidable");
var validator = require('validator');
var mysql = require('mysql');

// === Proxy code ===
// Proxy Server for http requests.
var proxy = http.createServer((request, response) => {
  // Logging of every request that gets passed through the proxy.
  console.log(request.method + " " + request.url);
  wss.broadcast(request.method + " " + request.url);

  var mysqlConnection = mysql.createConnection({
    host     : 'localhost',
    user     : 'root',
    password : '',
    database : 'proxy'
  });
  mysqlConnection.connect();

  // Query the database to check if the requested url is blacklisted.
  mysqlConnection.query('SELECT * FROM blacklist WHERE website="' + request.headers['host'] + '"', function(err, rows, fields) {
    // If the url is invalid ignore it.
    if (!validator.isURL(request.url)){
      console.log('INVALID URL ' + request.url);
      wss.broadcast("INVALID URL " + request.url);
      response.end();
    } 
    // If the url is blacklisted.
    else if (rows.length > 0) {
      console.log('BLACKLISTED WEBSITE ' + request.headers['host']);
      wss.broadcast('BLACKLISTED WEBSITE ' + request.headers['host']);
      // Respond 403 Forbidden.
      response.writeHeader(403, {"Content-Type": "text/html"}); 
      response.write("Blacklisted Website. Manage your blacklist at locahost:3000")
      response.end();
    } 
    // If it's a normal request.
    else {
      var mysqlConnection = mysql.createConnection({
        host     : 'localhost',
        user     : 'root',
        password : '',
        database : 'proxy'
      });
      mysqlConnection.connect();
      
      // Query the database to check if the url has been cached.
      mysqlConnection.query('SELECT * FROM cache WHERE url="' + request.url + '"', function(err, rows, fields) {
        // If there is no cache data for this url in the database.
        if(rows.length === 0) {
          var proxy_request = http.request({
            port: 80,
            host: request.headers['host'],
            method: request.method,
            path: request.url,
            headers: request.headers
          });

          proxy_request.addListener('response', (proxy_response) => {
            // Array to culminate the response body.
            var body = [];
            
            proxy_response.addListener('data', (chunk) => {
              // Write the data to the response.
              response.write(chunk, 'binary'); 

              // Write the data to the body.
              body.push(chunk);
            });

            proxy_response.addListener('end', () => {
              // If a 'last-modified' header was given by the response, cache the response.
              if(Date.parse(proxy_response.headers['last-modified'])) {
                // Concatenate all the chunks of the response body.
                body = Buffer.concat(body);

                var mysqlConnection = mysql.createConnection({
                  host     : 'localhost',
                  user     : 'root',
                  password : '',
                  database : 'proxy'
                });

                mysqlConnection.connect();

                var query = "INSERT INTO `cache` SET ?",
                  values = {
                    url: request.url,
                    time: Date.parse(proxy_response.headers['last-modified']),
                    data: body,
                    headers: new Buffer(JSON.stringify(proxy_response.headers), 'binary').toString('base64'),
                    status: proxy_response.statusCode
                  };
                // Insert the response status, headers and body into the database to be cached.
                mysqlConnection.query(query, values, function(err, rows, fields) {
                  console.log("CACHED " + request.url);
                  wss.broadcast("CACHED " + request.url);
                  response.end();
                });
              } 
              // End the response if no 'last-modified' header.
              else {
                response.end();
              }
            });
            // Write the response headers.
            response.writeHead(proxy_response.statusCode, proxy_response.headers);
          });
          
          // Request data.
          request.addListener('data', (chunk) => {
            // Request body.
            proxy_request.write(chunk, 'binary');
          });

          request.addListener('end', () => {
            proxy_request.end();
          });
        } 
        // Else try to serve the cached data for the response.
        else {
          // Must check if the requested data has changed since it's been cached.
          var proxy_request = http.request({
            port: 80,
            host: request.headers['host'],
            method: "HEAD",
            path: request.url,
            headers: request.headers
          });
          
          proxy_request.addListener('response', (proxy_response) => {
            var mysqlConnection = mysql.createConnection({
              host     : 'localhost',
              user     : 'root',
              password : '',
              database : 'proxy'
            });
            mysqlConnection.connect();

            // Get the cached data from the database.
            mysqlConnection.query('SELECT time, data, status, headers FROM cache WHERE url="' + request.url + '"', function(err, rows, fields) { 
              // If the requested data has changed since it was cached, get it again and update the cache.
              if(parseInt(rows[0].time) < parseInt(Date.parse(proxy_response.headers['last-modified']))) {
                proxy_request.addListener('response', (proxy_response) => {
                  // Array to culminate the response body.
                  var body = [];
                
                  proxy_response.addListener('data', (chunk) => {
                    // Write the data to the response.
                    response.write(chunk, 'binary'); 

                    // Write the data to the body.
                    body.push(chunk);
                  });

                  proxy_response.addListener('end', () => {
                    // If a 'last-modified' header was given by the response, cache the response.
                    if(Date.parse(proxy_response.headers['last-modified'])) {
                      // Concatenate all the chunks of the response body.
                      body = Buffer.concat(body);

                      var mysqlConnection = mysql.createConnection({
                        host     : 'localhost',
                        user     : 'root',
                        password : '',
                        database : 'proxy'
                      });

                      mysqlConnection.connect();

                      var query = "UPDATE `cache` SET time=:time, data=:data, headers=:headers, status=:status WHERE url=:url",
                        values = {
                          url: request.url,
                          time: Date.parse(proxy_response.headers['last-modified']),
                          data: body,
                          headers: new Buffer(JSON.stringify(proxy_response.headers), 'binary').toString('base64'),
                          status: proxy_response.statusCode
                        };
                      // Insert the response status, headers and body into the database to be cached.
                      mysqlConnection.query(query, values, function(err, rows, fields) {
                        console.log("RECACHED " + request.url);
                        wss.broadcast("RECACHED " + request.url);
                        response.end();
                      });
                    } 
                    // End the response if no 'last-modified' header.
                    else {
                      response.end();
                    }
                  });
                  // Write the response headers.
                  response.writeHead(proxy_response.statusCode, proxy_response.headers);
                });
              } 
              // Serve the cached data if the requested data has not changed.
              else { 
                console.log("SERVED FROM CACHE " + request.url);
                wss.broadcast("SERVED FROM CACHE " + request.url);
                response.writeHead(rows[0].status, JSON.parse(new Buffer('"'+rows[0].headers+'"', 'base64').toString()));
                response.write(rows[0].data)
                response.end();
              }
            });
          });

          // Request data.
          request.addListener('data', (chunk) => {
            // Request body.
            proxy_request.write(chunk, 'binary');
          });
          request.addListener('end', () => {
            proxy_request.end();
          });
        }
      });
      mysqlConnection.end();
    }
  });
  mysqlConnection.end();
}).listen(8080);

// Connect listener on Proxy Server for https requests.
proxy.on('connect', (req, cltSocket, head) => {
  var mysqlConnection = mysql.createConnection({
    host     : 'localhost',
    user     : 'root',
    password : '',
    database : 'proxy'
  });

  mysqlConnection.connect();

  // Query the database to check if the website is blacklisted.
  mysqlConnection.query('SELECT * FROM blacklist WHERE website="' + req.headers['host'].substring(0, req.headers['host'].length - 4) + '"', function(err, rows, fields) {
    // If the requested url is blacklisted.
    if (rows.length > 0) {
      console.log('BLACKLISTED WEBSITE ' + req.headers['host']);
      wss.broadcast('BLACKLISTED WEBSITE ' + req.headers['host']);
      // Respond with a 403 Forbidden.
      cltSocket.write('HTTP/1.1 403 Connection Forbidden\r\n' +
                  '\r\n');
      cltSocket.write('403 FORBIDDEN: Blacklisted website');
      cltSocket.end();
    } 
    // Else serve as normal.
    else {
      // Logging of every https request that gets passed through the proxy.
      console.log(req.method + " " + req.url);
      wss.broadcast(req.method + " " + req.url);

      // Connect to the origin Server.
      var srvUrl = url.parse(`http://${req.url}`);
      var srvSocket = net.connect(srvUrl.port, srvUrl.hostname, () => {
        cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                        'Proxy-agent: Node.js-Proxy\r\n' +
                        '\r\n');
        srvSocket.write(head);
        // Pipe all secure data between the two sockets.
        srvSocket.pipe(cltSocket);
        cltSocket.pipe(srvSocket);
      });
    }
  });

  mysqlConnection.end();
});

// Explicit TCP Error Handling
process.on('uncaughtException', function (e) {
  var pre = e.stack.split('\n')[0];
  // Prints connection errors
  if (pre.includes('ECONNRESET') || pre.includes('ECONNREFUSED') || pre.includes('ENOTFOUND')) {
    console.error('TCP ' + pre);
    wss.broadcast('TCP ' + pre);
  }
});

// === Blacklist server code ===
// Management console Server for Blacklist information.
var blacklistServer = http.createServer(function (req, res) {
  if(req.method === "GET") {
    displayForm(res);
  } else if(req.method === "POST") {
     processAllFieldsOfTheForm(req, res);
  }
}).listen(3000);

// Sends the html to be rendered on the management console webpage.
function displayForm(res) {
    fs.readFile('form.html', function (err, data) {
        res.writeHead(200, {
            'Content-Type': 'text/html'
        });
        // Send the html in form.html
        res.write(data);
        res.write("<b>current blacklist: </b>");
        
        var mysqlConnection = mysql.createConnection({
          host     : 'localhost',
          user     : 'root',
          password : '',
          database : 'proxy'
        });

        mysqlConnection.connect();

        // Query the database for every the Blacklist of websites.
        mysqlConnection.query('SELECT * from blacklist', function(err, rows, fields) {
          // Write a list of every blacklisted website.
          res.write('<ul id="blacklistList">');
          for (var i = 0; i < rows.length; i++) {
            res.write('<li class="' + rows[i].website + '">' + rows[i].website + '</li>');
          }
          res.write('</ul>');
          res.write("<p>" + rows.length + " total blacklisted</p>");
          res.end();
        });

        mysqlConnection.end();

    });
}

// Handles and performs the actions from a POST request from the management console.
function processAllFieldsOfTheForm(req, res) {
    var form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
        // If there is data to blacklist a website.
        if(fields.blacklistwebsite !== undefined) {
          var mysqlConnection = mysql.createConnection({
            host     : 'localhost',
            user     : 'root',
            password : '',
            database : 'proxy'
          });

          mysqlConnection.connect();

          mysqlConnection.query('INSERT INTO blacklist(website) VALUES("'  + fields.blacklistwebsite + '")', function(err, rows, fields) {
            displayForm(res);
          });

          mysqlConnection.end();
        } 
        // Else if there is data to unblacklist a website.
        else if(fields.unblacklistwebsite !== undefined) {
          var mysqlConnection = mysql.createConnection({
            host     : 'localhost',
            user     : 'root',
            password : '',
            database : 'proxy'
          });

          mysqlConnection.connect();

          mysqlConnection.query('DELETE FROM blacklist WHERE website="'  + fields.unblacklistwebsite + '"', function(err, rows, fields) {
            displayForm(res);
          });

          mysqlConnection.end();
        }
    });
}

// Websocket server to broadcast all data of request to the management console.
var WebSocketServer = require('ws').Server, wss = new WebSocketServer({ port: 8000 });

wss.broadcast = function broadcast(data) {
  wss.clients.forEach(function each(client) {
    client.send(data);
  });
};
