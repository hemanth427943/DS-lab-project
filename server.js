// Use public DNS so mongodb+srv:// addresses resolve on networks where Node's default DNS fails
require("node:dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();
const path = require("path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/dslab";
const MAX_VIDEO_BYTES = (Number(process.env.MAX_VIDEO_MB) || 300) * 1024 * 1024;
const MAX_MODULE_FILE_BYTES = (Number(process.env.MAX_MODULE_FILE_MB) || 50) * 1024 * 1024;
const MAX_COMPILER_SOURCE_BYTES = 48 * 1024;
const MAX_COMPILER_STDIN_BYTES = 8 * 1024;
const MAX_COMPILER_RESPONSE_BYTES = 256 * 1024;
const MAX_PYTHON_PROTOCOL_BYTES = 2 * 1024 * 1024;
const MAX_PYTHON_PLOT_BYTES = 256 * 1024;
const MAX_PYTHON_TOTAL_PLOT_BYTES = 768 * 1024;
const MAX_PYTHON_PLOTS = 4;
const PYTHON_PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const COMPILER_TIMEOUT_MS = 25000;
const COMPILER_ENDPOINT = "https://ce.judge0.com";
const PYTHON_SANDBOX_IMAGE = process.env.PYTHON_SANDBOX_IMAGE || "ds-lab-python-sandbox:latest";
const COMPILER_LANGUAGES = Object.freeze({
  java: 91,
  python: 109,
  c: 103,
});
const COMPILER_REQUESTS_PER_MINUTE = 8;
const COMPILER_REQUEST_WINDOW_MS = 60 * 1000;
const PYTHON_SANDBOX_TIMEOUT_MS = 20000;
const MAX_COMPILER_OUTPUT_BYTES = 32 * 1024;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const MODULE_FILE_TYPES = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Database models ----------
const { Schema } = mongoose;

// Sub-experiments keep the id the website creates (for example "6A")
const subExperimentSchema = new Schema({
  id: { type: String, required: true },
  letter: { type: String, required: true },
  title: { type: String, required: true },
  shortDescription: { type: String, required: true },
  d2Heading: { type: String, default: "" },
  d2Content: { type: String, default: "" },
  cover: { type: String, default: "" },
  video: { type: String, default: "" },
  githubUrl: { type: String, default: "" },
  completed: { type: Boolean, default: true },
}, { _id: false, id: false });

const experimentSchema = new Schema({
  number: { type: String, required: true },
  title: { type: String, required: true },
  shortDescription: { type: String, required: true },
  d2Heading: { type: String, default: "" },
  d2Content: { type: String, default: "" },
  cover: { type: String, required: true },
  video: { type: String, default: "" },
  githubUrl: { type: String, default: "" },
  subExperiments: { type: [subExperimentSchema], default: [] },
}, { timestamps: true });

experimentSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

// One profile (the ID card) for the whole site
const profileSchema = new Schema({
  key: { type: String, default: "main", unique: true },
  name: String,
  roll: String,
  section: String,
  branch: String,
  assistantProfessor: { type: String, default: "" },
  githubRepo: { type: String, default: "" },
  photo: { type: String, default: "" },
  logo: { type: String, default: "" },
}, { timestamps: true });

const learningModuleSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 1200 },
  fileId: { type: String, required: true },
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
}, { timestamps: true });

const toolSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 600 },
  details: { type: String, required: true, trim: true, maxlength: 20000 },
}, { timestamps: true });

const resourceSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 600 },
  url: { type: String, required: true, trim: true, maxlength: 2048 },
}, { timestamps: true });

learningModuleSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

for (const schema of [toolSchema, resourceSchema]) {
  schema.set("toJSON", {
    transform(doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  });
}

profileSchema.set("toJSON", {
  transform(doc, ret) {
    ["_id", "__v", "key", "createdAt", "updatedAt"].forEach((field) => delete ret[field]);
    return ret;
  },
});

const Experiment = mongoose.model("Experiment", experimentSchema);
const Profile = mongoose.model("Profile", profileSchema);
const LearningModule = mongoose.model("LearningModule", learningModuleSchema);
const Tool = mongoose.model("Tool", toolSchema);
const Resource = mongoose.model("Resource", resourceSchema);
let videoBucket; // GridFS bucket for uploaded videos, created after connecting
let moduleFileBucket;
const compilerRequestWindows = new Map();
let activeCompilerExecutions = 0;

// ---------- Validation ----------
const text = (value) => (typeof value === "string" ? value.trim() : "");

function requireText(value, message) {
  const clean = text(value);
  if (!clean) throw new HttpError(400, message);
  return clean;
}

function isValidGithubUrl(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:" && ["github.com", "www.github.com"].includes(url.hostname) && segments.length >= 2;
  } catch (error) {
    return false;
  }
}

function optionalGithub(value) {
  const clean = text(value);
  if (clean && !isValidGithubUrl(clean)) {
    throw new HttpError(400, "GitHub links must look like https://github.com/username/project-name.");
  }
  return clean;
}

function optionalImage(value) {
  const image = typeof value === "string" ? value : "";
  if (image && !image.startsWith("data:image/")) throw new HttpError(400, "Images must be uploaded image files.");
  return image;
}

function parseLearningModule(body = {}) {
  const title = requireText(body.title, "Module title is required.");
  const description = requireText(body.description, "A module description is required.");
  if (title.length > 120) throw new HttpError(400, "Module titles must be 120 characters or fewer.");
  if (description.length > 1200) throw new HttpError(400, "Module descriptions must be 1200 characters or fewer.");
  const fileId = requireText(body.fileId, "Upload a file for this module.");
  if (!OBJECT_ID.test(fileId)) throw new HttpError(400, "The uploaded module file is invalid.");
  return {
    title,
    description,
    fileId,
    fileName: requireText(body.fileName, "The uploaded file name is missing."),
    fileType: requireText(body.fileType, "The uploaded file type is missing."),
  };
}

function parseCatalogText(body = {}, type) {
  const title = requireText(body.title, `${type} title is required.`);
  const description = requireText(body.description, `A short ${type.toLowerCase()} description is required.`);
  const maxDescriptionLength = 600;
  if (title.length > 120) throw new HttpError(400, `${type} titles must be 120 characters or fewer.`);
  if (description.length > maxDescriptionLength) throw new HttpError(400, "Short descriptions must be 600 characters or fewer.");
  return { title, description };
}

function parseTool(body = {}) {
  const textFields = parseCatalogText(body, "Tool");
  const details = requireText(body.details, "A detailed tool explanation is required.");
  if (details.length > 20000) throw new HttpError(400, "Tool explanations must be 20000 characters or fewer.");
  return { ...textFields, details };
}

function parseResource(body = {}) {
  const textFields = parseCatalogText(body, "Resource");
  const value = requireText(body.url, "A resource URL is required.");
  if (value.length > 2048) throw new HttpError(400, "Resource URLs must be 2048 characters or fewer.");
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new HttpError(400, "Enter a valid URL beginning with https:// or http://.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new HttpError(400, "Enter a valid URL beginning with https:// or http://.");
  }
  return { ...textFields, url: url.toString() };
}

function parseSubExperiment(sub, number, usedLetters) {
  const letter = text(sub && sub.letter).toUpperCase();
  if (!/^[A-Z0-9]{1,3}$/.test(letter)) throw new HttpError(400, "Sub-experiment letters must be 1-3 letters or digits.");
  if (usedLetters.has(letter)) throw new HttpError(400, `Sub-experiment ${letter} is used twice.`);
  usedLetters.add(letter);

  return {
    id: `${number}${letter}`,
    letter,
    title: requireText(sub.title, `Sub-experiment ${letter} needs a name.`),
    shortDescription: requireText(sub.shortDescription ?? sub.description, `Sub-experiment ${letter} needs a short description.`),
    d2Heading: text(sub.d2Heading),
    d2Content: typeof sub.d2Content === "string" ? sub.d2Content : "", // kept exactly as typed
    cover: optionalImage(sub.cover),
    video: text(sub.video),
    githubUrl: optionalGithub(sub.githubUrl),
    completed: sub.completed !== false,
  };
}

function parseExperiment(body = {}) {
  const number = requireText(body.number, "Experiment number is required.");
  const subs = Array.isArray(body.subExperiments) ? body.subExperiments : [];
  const usedLetters = new Set();
  return {
    number,
    title: requireText(body.title, "Experiment name is required."),
    shortDescription: requireText(body.shortDescription ?? body.description, "A short description (D1) is required."),
    d2Heading: text(body.d2Heading),
    d2Content: typeof body.d2Content === "string" ? body.d2Content : "",
    cover: requireText(optionalImage(body.cover), "A cover image is required."),
    video: text(body.video),
    githubUrl: optionalGithub(body.githubUrl),
    subExperiments: subs.map((sub) => parseSubExperiment(sub || {}, number, usedLetters)),
  };
}

function parseProfile(body = {}) {
  return {
    name: requireText(body.name, "Name is required."),
    roll: requireText(body.roll, "Roll number is required."),
    section: requireText(body.section, "Section is required."),
    branch: requireText(body.branch, "Branch is required."),
    assistantProfessor: text(body.assistantProfessor),
    githubRepo: optionalGithub(body.githubRepo),
    photo: optionalImage(body.photo),
    logo: optionalImage(body.logo),
  };
}

// ---------- Video helpers (GridFS) ----------
async function deleteVideoFile(id) {
  if (!OBJECT_ID.test(id || "")) return;
  try {
    await videoBucket.delete(new mongoose.Types.ObjectId(id));
  } catch (error) {
    if (!/FileNotFound|no file with id/i.test(String(error.message))) throw error;
  }
}

async function deleteModuleFile(id) {
  if (!OBJECT_ID.test(id || "")) return;
  try {
    await moduleFileBucket.delete(new mongoose.Types.ObjectId(id));
  } catch (error) {
    if (!/FileNotFound|no file with id/i.test(String(error.message))) throw error;
  }
}

// ---------- App ----------
const app = express();
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()) }));
}

function enforceCompilerRateLimit(ip) {
  const now = Date.now();
  let window = compilerRequestWindows.get(ip);
  if (!window || window.resetAt <= now) {
    if (compilerRequestWindows.size >= 1000) {
      for (const [key, value] of compilerRequestWindows) {
        if (value.resetAt <= now) compilerRequestWindows.delete(key);
      }
    }
    if (!window && compilerRequestWindows.size >= 10000) {
      throw new HttpError(503, "The compiler is busy. Please try again shortly.");
    }
    window = { count: 0, resetAt: now + COMPILER_REQUEST_WINDOW_MS };
    compilerRequestWindows.set(ip, window);
  }
  if (window.count >= COMPILER_REQUESTS_PER_MINUTE) {
    throw new HttpError(429, "You have reached the compiler limit of 8 runs per minute. Please wait and try again.");
  }
  window.count += 1;
}

async function readCompilerResponse(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_COMPILER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new HttpError(502, "The compiler service returned too much output.");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function requestJudge0(url, options, signal) {
  const response = await fetch(url, { ...options, signal });
  if (!response.ok) {
    if (response.status === 429 || response.status === 503) {
      throw new HttpError(503, "The compiler service is busy. Please try again shortly.");
    }
    console.error(`Compiler service returned HTTP ${response.status}.`);
    throw new HttpError(502, "The compiler service is unavailable. Please try again later.");
  }
  try {
    return JSON.parse(await readCompilerResponse(response));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Compiler service returned an invalid response:", error.message);
    throw new HttpError(502, "The compiler service returned an invalid response.");
  }
}

function runPythonInSandbox(source, stdin) {
  return new Promise((resolve, reject) => {
    const containerName = `ds-lab-python-${randomUUID()}`;
    const args = [
      "run", "--rm", "--init", "--name", containerName,
      "--network=none",
      "--memory=1g", "--memory-swap=1g", "--cpus=1", "--pids-limit=64",
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
      "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--user=65534:65534",
      "--env", "HOME=/tmp",
      "--env", "MPLCONFIGDIR=/tmp/matplotlib",
      "--env", "MPLBACKEND=Agg",
      "--env", "TMPDIR=/tmp",
      "--ulimit", "cpu=18:20",
      "--ulimit", "fsize=10485760:10485760",
      "--ulimit", "nofile=1024:1024",
      PYTHON_SANDBOX_IMAGE,
      "/usr/local/bin/ds-lab-python-runner",
    ];
    const runner = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let settled = false;

    const stopContainer = () => {
      const killer = spawn("docker", ["kill", containerName], { stdio: "ignore", windowsHide: true });
      killer.on("error", (error) => console.error("Could not stop compiler container:", error.message));
      const killTimer = setTimeout(() => runner.kill(), 2000);
      killTimer.unref();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      stopContainer();
    }, PYTHON_SANDBOX_TIMEOUT_MS);

    const appendOutput = (stream, chunk) => {
      const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
      const streamLimit = stream === "stdout" ? MAX_PYTHON_PROTOCOL_BYTES : MAX_COMPILER_OUTPUT_BYTES;
      const remainingBytes = Math.max(0, streamLimit - currentBytes);
      const clipped = chunk.subarray(0, remainingBytes);
      if (stream === "stdout") {
        stdoutBytes += chunk.length;
        stdout += clipped.toString("utf8");
      } else {
        stderrBytes += chunk.length;
        stderr += clipped.toString("utf8");
      }
      if (chunk.length > remainingBytes && !outputLimited) {
        outputLimited = true;
        stopContainer();
      }
    };

    runner.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    runner.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
    runner.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(new HttpError(503, "Docker is not available to the server process. Start Docker Desktop, verify `docker info`, and build the Python sandbox image as described in COMPILER.md."));
      } else {
        reject(error);
      }
    });
    runner.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if ([125, 126, 127].includes(code) && stderr.trim()) {
        reject(new HttpError(503, `Could not start the Python sandbox. Build the configured image and check Docker access. ${stderr.trim().slice(0, 1000)}`));
        return;
      }
      if (timedOut) {
        resolve({
          ok: false, status: "runtime-error", detail: "Time Limit Exceeded",
          exitCode: code, compileOutput: "", compileError: "",
          stdout: "", stderr: [stderr, "Execution exceeded the 20-second time limit."].filter(Boolean).join("\n"),
        });
        return;
      }
      if (outputLimited) {
        resolve({
          ok: false, status: "runtime-error", detail: "Output Limit Exceeded",
          exitCode: code, compileOutput: "", compileError: "",
          stdout: "", stderr: "The Python sandbox response exceeded its output limit.",
        });
        return;
      }
      const marker = "DSLAB_EXECUTION_RESULT:";
      const resultLine = stdout.split(/\r?\n/).reverse().find((line) => line.startsWith(marker));
      if (!resultLine) {
        reject(new HttpError(502, `The Python sandbox returned an invalid response. ${stderr.trim().slice(0, 500)}`));
        return;
      }
      let result;
      try {
        result = JSON.parse(resultLine.slice(marker.length));
      } catch (error) {
        reject(new HttpError(502, "The Python sandbox returned an invalid execution result."));
        return;
      }
      const validStatuses = ["success", "compile-error", "runtime-error"];
      const validTextFields = ["detail", "compileOutput", "compileError", "stdout", "stderr"];
      let totalPlotBytes = 0;
      const invalidPlots = Array.isArray(result && result.plots) && result.plots.some((plot) => {
        if (typeof plot !== "string"
          || plot.length > Math.ceil(MAX_PYTHON_PLOT_BYTES / 3) * 4
          || !/^[A-Za-z0-9+/]*={0,2}$/.test(plot)) return true;
        const image = Buffer.from(plot, "base64");
        if (!image.subarray(0, PYTHON_PNG_SIGNATURE.length).equals(PYTHON_PNG_SIGNATURE)) return true;
        totalPlotBytes += image.length;
        return totalPlotBytes > MAX_PYTHON_TOTAL_PLOT_BYTES;
      });
      if (!result || typeof result !== "object"
        || typeof result.ok !== "boolean"
        || !validStatuses.includes(result.status)
        || validTextFields.some((field) => typeof result[field] !== "string")
        || !Array.isArray(result.plots)
        || result.plots.length > MAX_PYTHON_PLOTS
        || invalidPlots) {
        reject(new HttpError(502, "The Python sandbox returned an invalid execution result."));
        return;
      }
      resolve({
        ok: result.ok,
        status: result.status,
        detail: result.detail,
        exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
        compileOutput: result.compileOutput,
        compileError: result.compileError,
        stdout: result.stdout,
        stderr: result.stderr,
        plots: result.plots,
      });
    });
    runner.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") console.error("Could not send Python program input:", error.message);
    });
    runner.stdin.end(JSON.stringify({ code: source, stdin }));
  });
}

app.post("/api/compile", express.json({ limit: "512kb" }), wrap(async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const language = body.language;
  const source = body.code;
  const stdin = body.stdin === undefined ? "" : body.stdin;
  if (typeof language !== "string" || !Object.hasOwn(COMPILER_LANGUAGES, language)) {
    throw new HttpError(400, "Choose Java, Python, or C.");
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new HttpError(400, "Enter some code before running the compiler.");
  }
  if (Buffer.byteLength(source, "utf8") > MAX_COMPILER_SOURCE_BYTES) {
    throw new HttpError(413, "Code must be 48 KB or smaller.");
  }
  if (typeof stdin !== "string") {
    throw new HttpError(400, "Program input must be text.");
  }
  if (Buffer.byteLength(stdin, "utf8") > MAX_COMPILER_STDIN_BYTES) {
    throw new HttpError(413, "Program input must be 8 KB or smaller.");
  }
  if (activeCompilerExecutions >= 8) {
    throw new HttpError(503, "The compiler is busy. Please try again shortly.");
  }

  enforceCompilerRateLimit(req.ip);
  activeCompilerExecutions += 1;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, COMPILER_TIMEOUT_MS);
  try {
    if (language === "python") {
      res.json(await runPythonInSandbox(source, stdin));
      return;
    }
    const payload = {
      language_id: COMPILER_LANGUAGES[language],
      source_code: source,
      stdin,
      cpu_time_limit: 5,
      cpu_extra_time: 1,
      wall_time_limit: 10,
      memory_limit: 256000,
      stack_limit: 64000,
      max_processes_and_or_threads: 128,
      max_file_size: 5120,
      enable_network: false,
      number_of_runs: 1,
    };
    let result = await requestJudge0(`${COMPILER_ENDPOINT}/submissions?base64_encoded=false&wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }, controller.signal);
    while (result.status && [1, 2].includes(result.status.id)) {
      if (typeof result.token !== "string" || !result.token) {
        throw new HttpError(502, "The compiler service did not return a submission ID.");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await requestJudge0(
        `${COMPILER_ENDPOINT}/submissions/${encodeURIComponent(result.token)}?base64_encoded=false`,
        { method: "GET", headers: { Accept: "application/json" } },
        controller.signal,
      );
    }

    if (!result.status || typeof result.status.id !== "number") {
      throw new HttpError(502, "The compiler service returned an invalid execution status.");
    }
    const statusId = result.status.id;
    const ok = statusId === 3;
    const compileError = statusId === 6 ? (result.compile_output || result.message || "") : "";
    const runtimeError = !ok && statusId !== 6 ? (result.stderr || result.message || "") : "";
    res.json({
      ok,
      status: statusId === 6 ? "compile-error" : ok ? "success" : "runtime-error",
      detail: result.status.description || "",
      exitCode: result.exit_code ?? null,
      compileOutput: statusId === 3 && typeof result.compile_output === "string" ? result.compile_output : "",
      compileError,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof runtimeError === "string" ? runtimeError : "",
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (timedOut || error.name === "AbortError") {
      throw new HttpError(504, "The compiler service took too long to respond. Please try again.");
    }
    console.error("Compiler service request failed:", error.message);
    throw new HttpError(502, "The compiler service is unavailable. Please try again later.");
  } finally {
    clearTimeout(timeout);
    activeCompilerExecutions -= 1;
  }
}));

app.use(express.json({ limit: "30mb" })); // covers are stored as compressed image data

// ----- Experiments -----
app.get("/api/experiments", wrap(async (req, res) => {
  res.json(await Experiment.find().sort({ createdAt: 1 }));
}));

app.get("/api/experiments/:id", wrap(async (req, res) => {
  const experiment = OBJECT_ID.test(req.params.id) ? await Experiment.findById(req.params.id) : null;
  if (!experiment) throw new HttpError(404, "Experiment not found");
  res.json(experiment);
}));

app.post("/api/experiments", wrap(async (req, res) => {
  const created = await Experiment.create(parseExperiment(req.body));
  res.status(201).json(created);
}));

app.put("/api/experiments/:id", wrap(async (req, res) => {
  if (!OBJECT_ID.test(req.params.id)) throw new HttpError(404, "Experiment not found");
  const updated = await Experiment.findByIdAndUpdate(req.params.id, parseExperiment(req.body), {
    new: true,
    runValidators: true,
  });
  if (!updated) throw new HttpError(404, "Experiment not found");
  res.json(updated);
}));

app.delete("/api/experiments/:id", wrap(async (req, res) => {
  const removed = OBJECT_ID.test(req.params.id) ? await Experiment.findByIdAndDelete(req.params.id) : null;
  if (!removed) throw new HttpError(404, "Experiment not found");
  const videoIds = [removed.video, ...removed.subExperiments.map((sub) => sub.video)].filter(Boolean);
  await Promise.all(videoIds.map((id) => deleteVideoFile(id).catch((error) => console.error("Video cleanup failed:", error.message))));
  res.json({ ok: true });
}));

// ----- Learning modules -----
app.get("/api/modules", wrap(async (req, res) => {
  res.json(await LearningModule.find().sort({ createdAt: 1 }));
}));

app.post("/api/modules", wrap(async (req, res) => {
  const data = parseLearningModule(req.body);
  const [file] = await moduleFileBucket.find({ _id: new mongoose.Types.ObjectId(data.fileId) }).toArray();
  if (!file) throw new HttpError(400, "The uploaded module file could not be found.");
  res.status(201).json(await LearningModule.create(data));
}));

app.put("/api/modules/:id", wrap(async (req, res) => {
  if (!OBJECT_ID.test(req.params.id)) throw new HttpError(404, "Module not found");
  const data = parseLearningModule(req.body);
  const [file] = await moduleFileBucket.find({ _id: new mongoose.Types.ObjectId(data.fileId) }).toArray();
  if (!file) throw new HttpError(400, "The uploaded module file could not be found.");
  const existing = await LearningModule.findById(req.params.id);
  if (!existing) throw new HttpError(404, "Module not found");
  const updated = await LearningModule.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
  if (existing.fileId !== data.fileId) {
    await deleteModuleFile(existing.fileId).catch((error) => console.error("Module file cleanup failed:", error.message));
  }
  res.json(updated);
}));

app.delete("/api/modules/:id", wrap(async (req, res) => {
  const removed = OBJECT_ID.test(req.params.id) ? await LearningModule.findByIdAndDelete(req.params.id) : null;
  if (!removed) throw new HttpError(404, "Module not found");
  await deleteModuleFile(removed.fileId).catch((error) => console.error("Module file cleanup failed:", error.message));
  res.json({ ok: true });
}));

app.post("/api/module-files", wrap(async (req, res) => {
  const rawName = req.get("X-Module-File-Name") || "";
  let decodedName;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch (error) {
    throw new HttpError(400, "The uploaded file name is invalid.");
  }
  const fileName = path.basename(decodedName.replace(/\\/g, "/")).trim();
  if (!fileName || /[\u0000-\u001f\u007f]/.test(fileName)) throw new HttpError(400, "The uploaded file name is invalid.");
  const extension = path.extname(fileName).toLowerCase();
  const fileType = MODULE_FILE_TYPES[extension];
  if (!fileType) throw new HttpError(400, "Use a PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, or ZIP file.");
  if (Number(req.get("content-length")) > MAX_MODULE_FILE_BYTES) {
    throw new HttpError(413, `Module files can be at most ${Math.round(MAX_MODULE_FILE_BYTES / 1024 / 1024)} MB.`);
  }

  const upload = moduleFileBucket.openUploadStream(fileName, { metadata: { contentType: fileType } });
  let received = 0;
  let settled = false;
  await new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.unpipe(upload);
      upload.abort().catch(() => {});
      reject(error);
    };
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_MODULE_FILE_BYTES) {
        fail(new HttpError(413, `Module files can be at most ${Math.round(MAX_MODULE_FILE_BYTES / 1024 / 1024)} MB.`));
      }
    });
    req.on("error", fail);
    req.on("aborted", () => fail(new HttpError(400, "The file upload was interrupted.")));
    upload.on("error", fail);
    upload.on("finish", async () => {
      if (settled) return;
      settled = true;
      if (!received) {
        await deleteModuleFile(String(upload.id)).catch(() => {});
        reject(new HttpError(400, "The uploaded file is empty."));
        return;
      }
      resolve();
    });
    req.pipe(upload);
  });
  res.status(201).json({ id: String(upload.id), fileName, fileType });
}));

app.get("/api/module-files/:id", wrap(async (req, res) => {
  if (!OBJECT_ID.test(req.params.id)) throw new HttpError(404, "Module file not found");
  const id = new mongoose.Types.ObjectId(req.params.id);
  const [file] = await moduleFileBucket.find({ _id: id }).toArray();
  if (!file) throw new HttpError(404, "Module file not found");

  const disposition = req.query.download === "1" ? "attachment" : "inline";
  const safeName = encodeURIComponent(file.filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({
    "Content-Type": (file.metadata && file.metadata.contentType) || "application/octet-stream",
    "Content-Length": file.length,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${safeName}`,
    "X-Content-Type-Options": "nosniff",
  });
  moduleFileBucket.openDownloadStream(id).on("error", (error) => res.destroy(error)).pipe(res);
}));

app.delete("/api/module-files/:id", wrap(async (req, res) => {
  if (!OBJECT_ID.test(req.params.id)) throw new HttpError(404, "Module file not found");
  if (await LearningModule.exists({ fileId: req.params.id })) {
    throw new HttpError(409, "This file is still attached to a module.");
  }
  await deleteModuleFile(req.params.id);
  res.json({ ok: true });
}));

function registerCatalogRoutes(endpoint, Model, parser, label) {
  app.get(`/api/${endpoint}`, wrap(async (req, res) => {
    res.json(await Model.find().sort({ createdAt: 1 }));
  }));

  app.post(`/api/${endpoint}`, wrap(async (req, res) => {
    res.status(201).json(await Model.create(parser(req.body)));
  }));

  app.put(`/api/${endpoint}/:id`, wrap(async (req, res) => {
    if (!OBJECT_ID.test(req.params.id)) throw new HttpError(404, `${label} not found`);
    const updated = await Model.findByIdAndUpdate(req.params.id, parser(req.body), {
      new: true,
      runValidators: true,
    });
    if (!updated) throw new HttpError(404, `${label} not found`);
    res.json(updated);
  }));

  app.delete(`/api/${endpoint}/:id`, wrap(async (req, res) => {
    const removed = OBJECT_ID.test(req.params.id) ? await Model.findByIdAndDelete(req.params.id) : null;
    if (!removed) throw new HttpError(404, `${label} not found`);
    res.json({ ok: true });
  }));
}

registerCatalogRoutes("tools", Tool, parseTool, "Tool");
registerCatalogRoutes("resources", Resource, parseResource, "Resource");

// ----- Profile (ID card) -----
app.get("/api/profile", wrap(async (req, res) => {
  const profile = await Profile.findOne({ key: "main" });
  res.json(profile ? profile.toJSON() : {});
}));

app.put("/api/profile", wrap(async (req, res) => {
  const profile = await Profile.findOneAndUpdate({ key: "main" }, parseProfile(req.body), {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  });
  res.json(profile);
}));

// ----- Videos (streamed straight into MongoDB GridFS) -----
app.post("/api/videos", wrap(async (req, res) => {
  const type = req.get("X-Video-Type") || "";
  if (!type.startsWith("video/")) throw new HttpError(400, "Only video files can be uploaded.");
  if (Number(req.get("content-length")) > MAX_VIDEO_BYTES) {
    throw new HttpError(413, `Videos can be at most ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`);
  }

  const upload = videoBucket.openUploadStream(`video-${Date.now()}`, { metadata: { contentType: type } });
  let received = 0;
  await new Promise((resolve, reject) => {
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_VIDEO_BYTES) {
        req.unpipe(upload);
        upload.abort().catch(() => {});
        reject(new HttpError(413, `Videos can be at most ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`));
      }
    });
    req.on("error", reject);
    req.pipe(upload).on("error", reject).on("finish", resolve);
  });
  res.status(201).json({ id: String(upload.id) });
}));

app.get("/api/videos/:id", wrap(async (req, res) => {
  if (!OBJECT_ID.test(req.params.id)) throw new HttpError(404, "Video not found");
  const id = new mongoose.Types.ObjectId(req.params.id);
  const [file] = await videoBucket.find({ _id: id }).toArray();
  if (!file) throw new HttpError(404, "Video not found");

  res.set({
    "Content-Type": (file.metadata && file.metadata.contentType) || "application/octet-stream",
    "Content-Length": file.length,
  });
  videoBucket.openDownloadStream(id).on("error", (error) => res.destroy(error)).pipe(res);
}));

app.delete("/api/videos/:id", wrap(async (req, res) => {
  // Older videos were kept in the browser under non-ObjectId keys; answering 404 lets the page clean those up itself
  if (!OBJECT_ID.test(req.params.id)) throw new HttpError(404, "Video not found");
  await deleteVideoFile(req.params.id);
  res.json({ ok: true });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Route not found" }));

// ----- Website files -----
app.use(express.static(path.join(__dirname, "public")));

// ----- Errors -----
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") {
    error = new HttpError(413, req.path === "/api/compile"
      ? "Compiler requests must be 512 KB or smaller."
      : "That request is too large. Try smaller images.");
  }
  if (error.type === "entity.parse.failed") error = new HttpError(400, "The request body is not valid JSON.");
  if (error.name === "ValidationError" || error.name === "CastError") error = new HttpError(400, error.message);
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: "Something went wrong on the server." });
});

// ---------- Start ----------
async function start() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  videoBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "videos" });
  moduleFileBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "moduleFiles" });
  app.listen(PORT, () => console.log(`DS Lab running at http://localhost:${PORT}`));
}

start().catch((error) => {
  console.error("Could not start the server:", error.message);
  console.error("Check that MongoDB is running and MONGODB_URI in your .env file is correct.");
  process.exit(1);
});