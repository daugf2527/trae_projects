/// ######## BANNER WITH FIXES START ########

// ---- DYNAMIC_REQUIRE_FS_FIX ----
var require = (await import("node:module")).createRequire(import.meta.url);
var __filename = (await import("node:url")).fileURLToPath(import.meta.url);
var __dirname = (await import("node:path")).dirname(__filename);
// ---- DYNAMIC_REQUIRE_FS_FIX ----

/// ######## BANNER WITH FIXES END ########

import "./chunk-GCOF4WEW.js";

// node_modules/get-port/index.js
import net from "net";
import os from "os";
var Locked = class extends Error {
  constructor(port) {
    super(`${port} is locked`);
  }
};
var lockedPorts = {
  old: /* @__PURE__ */ new Set(),
  young: /* @__PURE__ */ new Set()
};
var releaseOldLockedPortsIntervalMs = 1e3 * 15;
var minPort = 1024;
var maxPort = 65535;
var interval;
var getLocalHosts = () => {
  const interfaces = os.networkInterfaces();
  const results = /* @__PURE__ */ new Set([void 0, "0.0.0.0"]);
  for (const _interface of Object.values(interfaces)) {
    for (const config of _interface) {
      results.add(config.address);
    }
  }
  return results;
};
var checkAvailablePort = (options) => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen(options, () => {
    const { port } = server.address();
    server.close(() => {
      resolve(port);
    });
  });
});
var getAvailablePort = async (options, hosts) => {
  if (options.host || options.port === 0) {
    return checkAvailablePort(options);
  }
  for (const host of hosts) {
    try {
      await checkAvailablePort({ port: options.port, host });
    } catch (error) {
      if (!["EADDRNOTAVAIL", "EINVAL"].includes(error.code)) {
        throw error;
      }
    }
  }
  return options.port;
};
var portCheckSequence = function* (ports) {
  if (ports) {
    yield* ports;
  }
  yield 0;
};
async function getPorts(options) {
  let ports;
  let exclude = /* @__PURE__ */ new Set();
  if (options) {
    if (options.port) {
      ports = typeof options.port === "number" ? [options.port] : options.port;
    }
    if (options.exclude) {
      const excludeIterable = options.exclude;
      if (typeof excludeIterable[Symbol.iterator] !== "function") {
        throw new TypeError("The `exclude` option must be an iterable.");
      }
      for (const element of excludeIterable) {
        if (typeof element !== "number") {
          throw new TypeError("Each item in the `exclude` option must be a number corresponding to the port you want excluded.");
        }
        if (!Number.isSafeInteger(element)) {
          throw new TypeError(`Number ${element} in the exclude option is not a safe integer and can't be used`);
        }
      }
      exclude = new Set(excludeIterable);
    }
  }
  if (interval === void 0) {
    interval = setInterval(() => {
      lockedPorts.old = lockedPorts.young;
      lockedPorts.young = /* @__PURE__ */ new Set();
    }, releaseOldLockedPortsIntervalMs);
    if (interval.unref) {
      interval.unref();
    }
  }
  const hosts = getLocalHosts();
  for (const port of portCheckSequence(ports)) {
    try {
      if (exclude.has(port)) {
        continue;
      }
      let availablePort = await getAvailablePort({ ...options, port }, hosts);
      while (lockedPorts.old.has(availablePort) || lockedPorts.young.has(availablePort)) {
        if (port !== 0) {
          throw new Locked(port);
        }
        availablePort = await getAvailablePort({ ...options, port }, hosts);
      }
      lockedPorts.young.add(availablePort);
      return availablePort;
    } catch (error) {
      if (!["EADDRINUSE", "EACCES"].includes(error.code) && !(error instanceof Locked)) {
        throw error;
      }
    }
  }
  throw new Error("No available ports found");
}
function portNumbers(from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new TypeError("`from` and `to` must be integer numbers");
  }
  if (from < minPort || from > maxPort) {
    throw new RangeError(`'from' must be between ${minPort} and ${maxPort}`);
  }
  if (to < minPort || to > maxPort) {
    throw new RangeError(`'to' must be between ${minPort} and ${maxPort}`);
  }
  if (from > to) {
    throw new RangeError("`to` must be greater than or equal to `from`");
  }
  const generator = function* (from2, to2) {
    for (let port = from2; port <= to2; port++) {
      yield port;
    }
  };
  return generator(from, to);
}
export {
  getPorts as default,
  portNumbers
};
