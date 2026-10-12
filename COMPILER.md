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

Build the Python sandbox image from the repository root before starting the
site:

```sh
docker build -f docker/Dockerfile.python-sandbox -t ds-lab-python-sandbox:latest .
```

The Node.js process must be able to invoke Docker and access its daemon. If the
site itself runs in Docker, provide access to the host Docker daemon socket;
the Node process only uses it to start a fixed Python image with fixed runtime
arguments. Do not mount the Docker socket inside the sandbox container.

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

The compiler requires a running Express server, just like the rest of the
site's API. If Judge0, Docker, or the network is unavailable, the editor
displays an explicit service error rather than simulating program output. Do
not install packages dynamically from submitted code: sandbox network access
is disabled and the scientific libraries are installed when building the
trusted image.
