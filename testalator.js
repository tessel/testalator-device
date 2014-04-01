// uses the https://github.com/rakeshpai/pi-gpio lib
var gpio = require("pi-gpio");
var sys = require('sys'),
  exec = require('child_process').exec,
  async = require("async"),
  fs = require("fs"),
  usb = require('usb'),
  path = require('path'),
  humanize = require('humanize')
  ;

var A0 = 8,
  A6 = 10,
  A8 = 12,
  A7 = 21,
  button = 22,
  reset = 24,
  ledDfu = 7,
  ledFirmware = 11,
  ledJS = 13,
  ledPins = 15,
  ledWifi = 16,
  ledDone = 19,
  ledError = 26,
  busy = 3,
  powerCycle = 18,
  config = 5,
  resetBottom = 23
  ;

var tesselClient = require("./deps/cli/src/index.js"),
  dfu = require("./deps/cli/dfu/tessel-dfu.js")
  ;

var TESSEL_VID = 0x1d50;
var TESSEL_PID = 0x6097;

var NXP_ROM_VID = 0x1fc9;
var NXP_ROM_PID = 0x000c;

var BOARD_V = 3;


// var otpPath = "./bin/tessel-otp-v3.bin",
var otpPath = "./bin/tm_otp_v02.bin",
  wifiPatchPath = "./bin/tessel-firmware.bin",
  firmwarePath = "./bin/tessel-firmware.bin",
  jsPath = "./tessel/tesselatee/index.js";

var network = "GreentownGuest",
  pw = "welcomegtl",
  auth = "wpa2";

var logger;
var deviceId; 

function setupLogger(next){
  var deviceSettings = require('./parser.js').create('device').process(['device'], function(res){
    exec('git rev-parse HEAD', function(err, git, stderr){
      fs.readdir('bin', function(err, files){
        logger = require('./logger.js').create(res.device, git, files);
        next && next();
      });
    });
  });
}

function run(){
  console.log("running");

  setupLogger(function (){
     async.waterfall([
      // function (cb) { setup(cb) },
      // function (cb) { emc(1, cb) },
      // function (cb) { rst(cb) },
      // function (cb) { usbCheck(NXP_ROM_VID, NXP_ROM_PID, cb) },
      // function (cb) { ram(otpPath, cb) },
      // function (cb) { emc(0, cb) },
      // function (cb) { rst(cb) },
      // function (cb) { usbCheck(TESSEL_VID, TESSEL_PID, cb) },
      // function (cb) { firmware(firmwarePath, cb) },
      // function (cb) { getBoardInfo(firmwarePath, cb) },
      // function (cb) { ram(wifiPatchPath, cb)}
      // function (cb) { wifiPatchCheck(cb) },
      // function (cb) { jsCheck(jsPath, cb) },
      function (cb) { wifiTest(network, pw, auth, cb)}
    ], function (err, result){
      // console.log("res called");
      logger.writeAll("Finished.");

      if (err){
        errorLed();
        logger.writeAll(logger.levels.error, "testalator", err);
        // console.log("Error, ", err);
      } else {
        // console.log("Success!", result);
        logger.writeAll("Success!");
      }

      process.exit();
    });
  }); 
}

function wifiTest(ssid, pw, security, callback){
  logger.writeAll("wifi test");

  tesselClient.selectModem(function notfound () {
    // console.error("No tessels found");
    logger.writeAll(logger.levels.error, "wifiTest", "no tessel found");

  }, function found (err, modem) {
    tesselClient.connectServer(modem, function () {

      var client = tesselClient.connect(6540, 'localhost');

      var maxCount = 5;
      var count = 0;
      // tessel wifi connect
      var retry = function() {

        client.configureWifi(ssid, pw, security, {
          timeout: 8
        }, function (err, data) {
          console.log(data);
          if (err) {
            // console.error('Retrying...');
            logger.writeAll(logger.levels.error, "wifiTest", "Retrying...");

            count++;
            if (count > maxCount) {
              logger.writeAll(logger.levels.error, "wifiTest", "wifi did not connect");

              callback("wifi did not connect")
            }
            else {
              // console.log("call reset forever");
              setImmediate(retry);
            }
          } else {
            // ping that ip to check
            exec("fping -c1 -t500 "+data.ip, function(error, stdout, stderr){
              if (!error){

                logger.writeAll("wifi connected");

                gpio.close(ledWifi, function (err){
                  gpio.open(ledWifi, "output", function(err){
                    gpio.write(ledWifi, 1, function(err) {
                    });
                  });
                });

                callback(null);
              } else {
                callback(error);
              }
            });
          }
        });
      }

      retry();

    });
  });
}

function bundle (arg)
{
  var hardwareResolve = require('hardware-resolve');
  var effess = require('effess');

  function duparg (arr) {
    var obj = {};
    arr.forEach(function (arg) {
      obj[arg] = arg;
    })
    return obj;
  }

  var ret = {};

  hardwareResolve.root(arg, function (err, pushdir, relpath) {
    var files;
    if (!pushdir) {
      if (fs.lstatSync(arg).isDirectory()) {
        ret.warning = String(err).replace(/\.( |$)/, ', pushing just this directory.');

        pushdir = fs.realpathSync(arg);
        relpath = fs.lstatSync(path.join(arg, 'index.js')) && 'index.js';
        files = duparg(effess.readdirRecursiveSync(arg, {
          inflateSymlinks: true,
          excludeHiddenUnix: true
        }))
      } else {
        ret.warning = String(err).replace(/\.( |$)/, ', pushing just this file.');

        pushdir = path.dirname(fs.realpathSync(arg));
        relpath = path.basename(arg);
        files = duparg([path.basename(arg)]);
      }
    } else {
      // Parse defaults from command line for inclusion or exclusion
      var defaults = {};

      // Get list of hardware files.
      files = hardwareResolve.list(pushdir, null, null, defaults);
      // Ensure the requested file from command line is included, even if blacklisted
      if (!(relpath in files)) {
        files[relpath] = relpath;
      }
    }

    ret.pushdir = pushdir;
    ret.relpath = relpath;
    ret.files = files;

    // Update files values to be full paths in pushFiles.
    Object.keys(ret.files).forEach(function (file) {
      ret.files[file] = fs.realpathSync(path.join(pushdir, ret.files[file]));
    })
  })

  // Dump stats for files and their sizes.
  var sizelookup = {};
  Object.keys(ret.files).forEach(function (file) {
    sizelookup[file] = fs.lstatSync(ret.files[file]).size;
    var dir = file;
    do {
      dir = path.dirname(dir);
      sizelookup[dir + '/'] = (sizelookup[dir + '/'] || 0) + sizelookup[file];
    } while (path.dirname(dir) != dir);
  });

  ret.size = sizelookup['./'] || 0;

  return ret;
}

function jsCheck(path, callback){
  // tessel upload code
  tesselClient.selectModem(function notfound () {
    callback("Error, no device found");
  }, function found (err, modem) {
    tesselClient.connectServer(modem, function () {
      var client = tesselClient.connect(6540, 'localhost');
      var ret = bundle(path);
      if (ret.warning) {
        logger.writeAll(logger.level.warning, "jsCheck", ret.warning);
        // console.error(('WARN').yellow, ret.warning.grey);
      }
      // console.error(('Bundling directory ' + ret.pushdir + ' (~' + humanize.filesize(ret.size) + ')').grey);
      logger.writeAll("bundling"+ ret.pushdir+ ' (~' + humanize.filesize(ret.size) + ')');

      tesselClient.bundleFiles(ret.relpath, null, ret.files, function (err, tarbundle) {
        // console.error(('Deploying bundle (' + humanize.filesize(tarbundle.length) + ')...').grey);
        if (err){
          logger.writeAll(logger.levels.error, "jsCheck", err);
          errorLed();
          callback(err);
        } else {
          gpio.close(ledJS, function (err){
            gpio.open(ledJS, "output", function(err){
              gpio.write(ledJS, 1, function(err) {
              });
            });
          });
        }

        client.deployBundle(tarbundle, {});

        // check for the script to finish
        client.on('command', function (command, data, debug) {
          if (command == "s" && data[0] == '{' && data[data.length-1] == '}'){
            data = JSON.parse(data);
            // check test status
            if (data.jsTest && data.jsTest == 'passed'){

              logger.writeAll(data.jsTest + " passed");
              // toggle led
              gpio.close(ledPins, function (err){
                gpio.open(ledPins, "output", function(err){
                  gpio.write(ledPins, 1, function(err) {
                    callback();
                  });
                });
              });
            } else if (data.jsTest && data.jsTest == 'failed'){

              logger.writeAll(logger.levels.error, data.jsTest, "failed");
              // toggle led
              errorLed();
            }
          } else if (command == "s" ){
            // push data into logging
            logger.deviceWrite("jsTest", data);
          }
        });
      });
    });
  });
}

function wifiPatchCheck(callback){
  logger.write("wifiPatchCheck");
  // wait 20 seconds, check for wifi version
  setTimeout(function(){
    // read wifi version
    logger.write("wifiPatchCheck beginning");

    tesselClient.selectModem(function notfound () {
      callback("Error, no device found");
    }, function found (err, modem) {
      tesselClient.connectServer(modem, function () {
        // console.log("connected");
        logger.write("wifiPatchCheck connected");

        var client = tesselClient.connect(6540, 'localhost');
        var called = false;
        client.on('command', function (command, data, debug) {
          if (command == "W" && data.cc3000firmware && !called){
            logger.write("wifiPatchCheck got "+data.cc3000firmware);
            logger.deviceWrite("wifiPatchCheck got "+data.cc3000firmware);
            // get the json
            if (data.cc3000firmware == "1.24"){
              logger.deviceUpdate("wifi", true);
              called = true;
              callback(null);
            } else if (data.cc3000firmware == "1.10"){
              logger.deviceUpdate("wifi", false);
              logger.write(logger.levels.error, "wifiVersion", data.cc3000firmware);
              logger.deviceWrite(logger.levels.error, "wifiVersion", data.cc3000firmware);
              called = true;
              callback("error, wifi patch did not update");
            }
          } 
        });
      });
    });

  }, 20000);
}

function firmware(path, callback){
  logger.write("starting firmware write on "+path);
  // config and reset
  gpio.close(config, function (err) {
    gpio.open(config, "output", function(err){
      gpio.write(config, 0, function(err){
        rst(function(err){
          usbCheck(TESSEL_VID, TESSEL_PID, function(error, data){
            // console.log("error", error, "data", data);
            if (!error){
              // console.log("writing binary: ", path);

              logger.write("writing binary on "+path);
              console.log(fs.readdirSync("./bin"));
              require('./deps/cli/dfu/tessel-dfu').write(fs.readFileSync(path), function(err){
                // console.log("did we get an err?", err);
                if (err){
                  logger.write(logger.levels.error, "firmware", err);
                  errorLed();
                } else {
                  gpio.close(ledFirmware, function (err){
                    gpio.open(ledFirmware, "output", function(err){
                      gpio.write(ledFirmware, 1, function(err) {
                        
                      });
                    });
                  });
                }

                callback(err);

              });
            }
          });
        });
      });
    });
  });
}

function ram(path, callback){
  // console.log("path", path);
  logger.write("running ram patch on "+path);

  dfu.runRam(fs.readFileSync(path), function(){
    callback(null);
  });
}

function usbCheck(vid, pid, callback){
  setTimeout(function(){
    // console.log("checking usb for ", vid, pid);
    logger.write("checking usb for "+vid+"/"+pid);

    if (usb.findByIds(vid, pid)){
      callback(null);
    } else {
      callback("Error cannot find vid/pid: " + vid + " " + pid, "usb check");
    }
  }, 1000);
}

function rst(callback){
  // close it?
  logger.write("resetting Tessel");

  gpio.close(reset, function (err){
    if (err){

    }
    gpio.open(reset, "output", function(err){
      gpio.write(reset, 0, function(err) {
        // wait a bit
        setTimeout(function() {
          gpio.write(reset, 1, function(err) {
            logger.write("starting tessel back up");
            callback(err);
          });
        }, 100);
      });
    });
  });
}

function errorLed(){
  gpio.close(ledError, function (err){
    gpio.open(ledError, "output", function(err){
      gpio.write(ledError, 1, function(err) {
        
      });
    });
  });
}

function getBoardInfo(callback) {

  logger.write("getting board info");

  tesselClient.selectModem(function notfound () {
    callback("Error, no device found");
  }, function found (err, modem) {
    tesselClient.connectServer(modem, function () {
      var client = tesselClient.connect(6540, 'localhost');

      var keys = {'firmware':"", "runtime": "", "board":"", "serial":""};
      var count = 0;

      var created = false;

      client.on('command', function (command, data, debug) {
        console.log(debug ? command.grey : command.red, data);
        if (command == "H" && (data.firmware || data.runtime || data.board || data.serial)){
          keys[Object.keys(data)[0]] = data[Object.keys(data)[0]];
          count++;

          logger.write("got key "+Object.keys(data)[0]+"="+data[Object.keys(data)[0]]);

          if (!created && count >= 4) {
            created = true;
            logger.device(keys);

            if (Number(keys.board) == BOARD_V){
              logger.deviceUpdate("otp", true);

              gpio.close(ledDfu, function (err){
                gpio.open(ledDfu, "output", function(err){
                  gpio.write(ledDfu, 1, function(err) {
                    
                  });
                });
              });

              callback(null);
            } else {
              logger.deviceUpdate("otp", false);
              logger.deviceWrite(logger.levels.error, "otpVersion", BOARD_V );
              errorLed();
              callback("OTP is set as "+BOARD_V);
            }
          }
        } 
      });
    });
  });
}

function closeAll(callback){
  var funcArray = [];
  [A0, A6, A8, A7, button, reset, ledDfu, ledFirmware, 
  ledJS, ledPins, ledWifi, ledDone, ledError, busy, 
  powerCycle, config, resetBottom].forEach(function(element){
    funcArray.push(function(cb){
      gpio.close(element, function(err){
        cb(err);
      })
    });
  })

  async.parallel(funcArray, function (err, res){
    if (err){
      console.log("couldn't close pin", err);
      callback(err);
    } else{
      callback(null);
    }
  });
}

function setup(callback){
  // var pinArr = ;
  // // unexport everything
  // pinArr.forEach(function (pin){
  //   console.log("pin", pin);
  //   gpio.close(pin);
  // });
  logger.write("setting up...");
  var funcArray = [];
  [reset, ledDfu, ledFirmware, ledJS, ledPins, 
  ledWifi, ledDone, ledError, busy].forEach(function(element){
    funcArray.push(function(cb){
      gpio.open(element, "output", function(err){
        // gpio.close(element);
        gpio.write(element, 0, function(err) {
          cb(err);
        });
      });
    });
  });

  closeAll(function(err){
    async.parallel(funcArray, function (err, results){
      if (err){
        logger.write("couldn't setup pin", err);
        callback(err);
      }

      // wait until a button is pressed.
      gpio.open(button, "input", function (err){
        var intervalId = setInterval(function(){
          gpio.read(button, function(err, value){
            if (value == 1 ) {
              clearInterval(intervalId);
              logger.write("done with setting up");
              callback(err);
            }
          });
        }, 20);
      });
    });
  });
}

function emc(enable, callback){
  var maxNum = 4, 
    count = 0,
    totalErr = null,
    pinArray = {};

  pinArray[A0] = 0;
  pinArray[A6] = 1;
  pinArray[A7] = 0;
  pinArray[A8] = 1;

  // console.log("pin array", pinArray);
  logger.write("setting up external memory controller pins");

  if (enable){
    // open up EMC pins and toggle for DFU mode
    Object.keys(pinArray).forEach(function(pin){
      console.log("emc", pin);
      gpio.open(pin, "output", function(err){
        // TODO: all except one should be low
        gpio.write(pin, pinArray[pin], function(err) {
          totalErr = totalErr || err;
          count++;
          if (count >= maxNum){
            callback(err);
          }
        });
      });
    });
  } else {
    // close up all EMC pins
    Object.keys(pinArray).forEach(function(pin){
      gpio.close(pin, function (err){
        gpio.open(pin, "input", function(err) {
          totalErr = totalErr || err;
          count++;
          if (count >= maxNum){
            logger.write("set emc pins as inputs");
            callback(err);
          }
        });
      })
    });
  }
}

run();

function exit() {
  closeAll(function(err){
    // exit for real
    process.exit();
  });
}

process.on('SIGINT', exit);