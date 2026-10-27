# Online compiler

The compiler page is served with the rest of the site at `/compiler.html`. Code
execution is proxied by `POST /api/compile` to the fixed Judge0 CE API endpoint;
the browser never calls the compiler service directly and no API key is needed.

## Requirements

- Node.js 18 or later, as required by the existing application.
- Outbound HTTPS access from the server to `ce.judge0.com`.
- Docker Engine available to the Node.js process for the isolated Python runtime.
- An internet connection in the browser to load CodeMirror 5.65.16 from
  cdnjs.

On Windows, install and start Docker Desktop with Linux container support.
From the repository root, confirm the daemon is reachable and build the image
before starting the site:

```powershell
docker info
docker build -f docker\Dockerfile.python-sandbox -t ds-lab-python-sandbox:latest .
docker image inspect ds-lab-python-sandbox:latest
npm start
```

If PowerShell says `docker` is not recognized, Docker Desktop is not installed
or its CLI is not on `PATH`; restart the terminal or VS Code after installing
it. If `docker info` cannot contact the daemon, wait for Docker Desktop to
finish starting before building the image.

The Node.js process must be able to invoke `docker` and access its daemon. The
image name defaults to `ds-lab-python-sandbox:latest`; set
`PYTHON_SANDBOX_IMAGE` in `.env` only if you build and tag the image under a
different name. If the site itself runs in Docker, provide the server
container access to the host Docker daemon using the platform's supported
mechanism. Do not mount the Docker socket inside the sandbox container.

The Express process validates languages, rejects empty and oversized
submissions, limits requests per client, caps concurrent runs, applies a
25-second upstream timeout to Java and C, and bounds compiler output. Java and
C use fixed Judge0 language IDs and resource limits. Python source and standard
input are piped to a fresh per-run container; user source is never passed to a
shell. Python containers use `--network=none`, a read-only root filesystem,
unprivileged UID, dropped capabilities, no-new-privileges, a 1 GB memory limit,
one CPU, a 64-process limit, a 20-second wall timeout, an 18-second CPU ulimit,
and bounded writable temporary storage and output. The Python image pins and
preinstalls NumPy, Pandas, Matplotlib, Seaborn, and Scikit-learn.
Python output and errors are captured from the actual run. Matplotlib figures
left open by the program are returned as bounded PNG images and displayed in
the experiment and compiler output panels.

The compiler requires a running Express server, just like the rest of the
site's API. If Judge0, Docker, or the network is unavailable, the editor
displays an explicit service error rather than simulating program output. Do
not install packages dynamically from submitted code: sandbox network access
is disabled and the scientific libraries are installed when building the
trusted image.

To check the Python API after starting the server, submit a small Python
program from an experiment or the compiler page. A successful response has
`status: "success"` and real `stdout`; a plotting program also returns one or
more `plots`. Syntax and runtime failures return their captured diagnostics.
If Docker is not installed or running, `docker info` will fail and the API
returns a service error rather than executing Python in the Node.js process.
