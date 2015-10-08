var bodyParser = require("body-parser");
var express = require("express");
var formidable = require("formidable");
var fs = require("fs");
var http = require("http");
var path = require("path");

var app = express();
var port = process.argv[2] || 11235;

// serve static files from main directory
app.use(express.static("./"));

// handle uploaded files
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.route("/upload").post(function(req, res, next) {
   var form = formidable.IncomingForm();
   form.uploadDir = "./sketches";
   form.keepExtensions = true;

   form.parse(req, function(err, fields, files) {
      res.writeHead(200, {"content-type": "text/plain"});
      res.write('received upload:\n\n');

      var filename = fields.sketchName;
      var suffix = ".js";
      if (filename.indexOf(suffix, filename.length - suffix.length) == -1)
         filename += suffix;

      fs.writeFile(form.uploadDir + "/" + filename, fields.sketchContent, function(err) {
         if (err) {
            console.log(err);
         } else {
            console.log("file written");
         }
      });

      res.end();
   });
});

var values = {};

app.route("/setValue").post(function(req, res, next) {
   var form = formidable.IncomingForm();
   form.parse(req, function(err, fields, files) {
      values[fields.key] = fields.value;
   });
});

app.route("/getValue").post(function(req, res, next) {
   var form = formidable.IncomingForm();
   form.parse(req, function(err, fields, files) {
      returnString(res, values[fields.key]);
   });
});

app.route("/set").post(function(req, res, next) {
   var form = formidable.IncomingForm();
   form.parse(req, function(err, fields, files) {
      res.writeHead(200, {"content-type": "text/plain"});
      res.write('received upload:\n\n');

      var key = fields.key;

      var suffix = ".json";
      if (key.indexOf(suffix, key.length - suffix.length) == -1)
         key += suffix;

      fs.writeFile(key, fields.value, function(err) {
         if (err) {
            console.log(err);
         } else {
            console.log("file written");
         }
      });

      res.end();
   });
});

app.route("/talk").get(function(req, res) {
   res.sendfile("index.html");
});

app.route("/listen").get(function(req, res) {
   res.sendfile("index.html");
});

var time = 0;

// handle request for the current time
app.route("/getTime").get(function(req, res) {
   time = (new Date()).getTime();
   returnString(res, '' + time);
});

// handle request for list of available sketches
app.route("/ls_sketches").get(function(req, res) {
   readDir(res, "sketches");
});

// handle request for list of available images
app.route("/ls_images").get(function(req, res) {
   readDir(res, "images");
});

// handle request for list of state files
app.route("/ls_state").get(function(req, res) {
   readDir(res, "state");
});

function returnString(res, str) {
   res.writeHead(200, { "Content-Type": "text/plain" });
   res.write(str + "\n");
   res.end();
};

function readDir(res, dirName) {
   fs.readdir("./" + dirName + "/", function(err, files) {
      if (err) {
         res.writeHead(500, { "Content-Type": "text/plain" });
         res.write(err);
         console.log("error listing the " + dirName + " directory" + err);
         res.end();
         return;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      for (var i = 0; i < files.length; i++) {
         res.write(files[i] + "\n");
      }
      res.end();
   });
}

// handle request for appcache file -- needs a special Content-Type
app.route("/appcache").get(function(req, res) {
   recursive_ls("./", function(err, files) {
      if (err) {
         res.writeHead(500, { "ContentType": "text/plain" });
         res.write(err);
         res.end();
         console.log("error while building appcache manifest");
         return;
      }

      res.writeHead(200, { "ContentType": "text/cache-manifest" });
      res.write("CACHE MANIFEST\n");
      files.sort();
      files.forEach(function(file) {
         if ((file.endsWith("html") || file.endsWith("js") || file.endsWith("json"))
               && !file.contains("server") && !file.contains(".git") && !file.contains("swp")) {
            res.write(file + "\n");
         }
      });
      res.end();
   });
});

var recursive_ls = function(dir, callback) {
   var cwd = process.cwd() + "/";
   var results = [];
   fs.readdir(dir, function(err, list) {
      if (err) return callback(err);
      var pending = list.length;
      if (!pending) return callback(null, results);
      list.forEach(function(file) {
         file = path.resolve(dir, file);
         fs.stat(file, function(err, stat) {
            if (stat && stat.isDirectory()) {
               recursive_ls(file, function(err, res) {
                  results = results.concat(res);
                  if (!--pending) callback(null, results);
               });
            } else {
               results.push(file.replace(cwd, ""));
               if (!--pending) callback(null, results);
            }
         });
      });
   });
};

function isDef(v) { return ! (v === undefined); }

String.prototype.endsWith = function(suffix) {
   return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

String.prototype.contains = function(substr) {
   return this.indexOf(substr) > -1;
};

// PROTOBUF SETUP -- FOR SENDING HEAD TRACKING DATA
try {
   var ProtoBuf = require("protobufjs")
       builder = ProtoBuf.loadProtoFile("server/head.proto"),
       Chalktalk = builder.build("Chalktalk"),
       Head = Chalktalk.Head;
} catch (err) {
   console.log("Something went wrong during protobuf setup:\n" + err
         + "\nIf you have not done so, please run 'npm install' from the server directory");
}

// CREATE THE HTTP SERVER
var httpserver = http.Server(app);

// WEBSOCKET ENDPOINT SETUP
try {
   var WebSocketServer = require("ws").Server;
   var wss = new WebSocketServer({ port: 22346 });

   wss.on("connection", function(ws) {
      var startTime = (new Date()).getTime();

      var cameraUpdateInterval = null;
      function toggleStereo() {
         if (cameraUpdateInterval == null) {
            cameraUpdateInterval = setInterval(function() {
               var clockTime = (new Date()).getTime();
               var time = clockTime - startTime;

               var head = new Head({
                  "translation": {
                     "x": 0,
                     "y": 0,
                     "z": 0
                  },
                  "rotation": {
                     "x": Math.cos((time / 1000)),
                     "y": Math.sin(2 * (time / 1000)),
                     "z": Math.sin((time / 1000) / 2)
                  }
               });
               ws.send(head.toBuffer());
            }, 1000 / 60);
         } else {
            clearInterval(cameraUpdateInterval);
            cameraUpdateInterval = null;
         }
      }

      ws.on("message", function(msg) {
         console.log("got message: " + msg);
         if (msg == "toggleStereo") {
            toggleStereo();
         }
      });

      ws.on("close", function() {
         clearInterval(cameraUpdateInterval);
         cameraUpdateInterval = null;
      });
   });
} catch (err) {
   console.log("\x1b[31mCouldn't load websocket library. Disabling event broadcasting."
         + " Please run 'npm install' from Chalktalk's server directory\x1b[0m");
}

// DIFFSYNC ENDPOINT SETUP
try {
   var io = require("socket.io")(httpserver);

   var diffsync = require("diffsync");
   var dataAdapter = new diffsync.InMemoryDataAdapter();

   var diffsyncServer = new diffsync.Server(dataAdapter, io);
} catch (err) {
   console.log("Something went wrong during diffsync setup:\n" + err
         + "\nIf you have not done so, please run 'npm install' from the server directory");
}

// START THE HTTP SERVER
httpserver.listen(parseInt(port, 10), function() {
   console.log("Listening on port %d", httpserver.address().port);
});
