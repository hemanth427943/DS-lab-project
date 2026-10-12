const languageConfig = {
  java: {
    name: "Java",
    filename: "Main.java",
    mode: "text/x-java",
    defaultCode: `public class Main {
  public static void main(String[] args) {
    System.out.println("Hello, World!");
  }
}`,
  },
  python: {
    name: "Python",
    filename: "main.py",
    mode: "python",
    defaultCode: `print("Hello, World!")`,
  },
  c: {
    name: "C",
    filename: "main.c",
    mode: "text/x-csrc",
    defaultCode: `#include <stdio.h>

int main() {
  printf("Hello, World!\\n");
  return 0;
}`,
  },
};

const codeByLanguage = Object.fromEntries(
  Object.entries(languageConfig).map(([key, language]) => [key, language.defaultCode]),
);
const languagePicker = document.getElementById("languagePicker");
const workspace = document.getElementById("compilerWorkspace");
const workspaceTitle = document.getElementById("workspaceTitle");
const editorFilename = document.getElementById("editorFilename");
const codeTextarea = document.getElementById("codeEditor");
const programInput = document.getElementById("programInput");
const runButton = document.getElementById("runCodeBtn");
const resetButton = document.getElementById("resetCodeBtn");
const clearOutputButton = document.getElementById("clearOutputBtn");
const backButton = document.getElementById("backToLanguages");
const runStatus = document.getElementById("runStatus");
const runStatusText = document.getElementById("runStatusText");
const consoleOutput = document.getElementById("consoleOutput");
const languageButtons = document.querySelectorAll("[data-language]");
let activeLanguage = "";
let editor;
let isRunning = false;

function setStatus(message, state = "") {
  runStatus.className = `run-status${state ? ` is-${state}` : ""}`;
  runStatusText.textContent = message;
}

function updateRunButton() {
  runButton.disabled = isRunning || !activeLanguage || !editor || !editor.getValue().trim();
}

function updateLanguage(languageKey) {
  const language = languageConfig[languageKey];
  if (!language || isRunning) return;

  if (activeLanguage && editor) {
    codeByLanguage[activeLanguage] = editor.getValue();
  }

  activeLanguage = languageKey;
  editor.setOption("mode", language.mode);
  editor.setValue(codeByLanguage[languageKey]);
  workspaceTitle.textContent = `${language.name} Compiler`;
  editorFilename.textContent = language.filename;
  document.querySelectorAll(".language-tab").forEach((button) => {
    const isSelected = button.dataset.language === languageKey;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
  consoleOutput.textContent = "Run your code to see output here.";
  consoleOutput.classList.remove("is-error");
  setStatus("Ready to run your code");
  updateRunButton();
  editor.refresh();
}

function showWorkspace(languageKey) {
  if (!editor) {
    if (!window.CodeMirror) {
      setStatus("The code editor could not be loaded. Check your internet connection and reload.", "error");
      consoleOutput.textContent = "CodeMirror failed to load.";
      consoleOutput.classList.add("is-error");
      return;
    }
    editor = window.CodeMirror.fromTextArea(codeTextarea, {
      lineNumbers: true,
      mode: languageConfig[languageKey].mode,
      theme: "material-darker",
      indentUnit: 4,
      tabSize: 4,
      lineWrapping: true,
      autofocus: true,
    });
    editor.on("change", () => {
      if (activeLanguage) codeByLanguage[activeLanguage] = editor.getValue();
      updateRunButton();
    });
  }

  languagePicker.hidden = true;
  workspace.hidden = false;
  updateLanguage(languageKey);
  window.requestAnimationFrame(() => editor.refresh());
}

function formatExecution(result) {
  const sections = [];
  if (result.compileOutput) sections.push(`Compiler output:\n${result.compileOutput.trimEnd()}`);
  if (result.compileError) sections.push(`Compilation error:\n${result.compileError.trimEnd()}`);
  if (result.stdout) sections.push(`Output:\n${result.stdout.trimEnd()}`);
  if (result.stderr) sections.push(`Runtime error:\n${result.stderr.trimEnd()}`);
  return sections.join("\n\n") || (result.ok ? "Program completed with no output." : "Execution failed without diagnostic output.");
}

async function runCode() {
  const source = editor.getValue();
  if (!source.trim() || isRunning) {
    updateRunButton();
    return;
  }

  isRunning = true;
  updateRunButton();
  resetButton.disabled = true;
  clearOutputButton.disabled = true;
  backButton.disabled = true;
  document.querySelectorAll(".language-tab").forEach((button) => { button.disabled = true; });
  workspace.setAttribute("aria-busy", "true");
  consoleOutput.textContent = "Running your code in the sandbox…";
  consoleOutput.classList.remove("is-error");
  setStatus("Running…", "running");

  try {
    const response = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: activeLanguage, code: source, stdin: programInput.value }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Compiler request failed (${response.status}).`);
    }

    consoleOutput.textContent = formatExecution(result);
    consoleOutput.classList.toggle("is-error", !result.ok);
    if (result.ok) {
      setStatus("Execution completed successfully", "success");
    } else if (result.status === "compile-error") {
      setStatus("Compilation failed", "error");
    } else {
      setStatus(`Execution failed${result.detail ? `: ${result.detail}` : ""}`, "error");
    }
  } catch (error) {
    consoleOutput.textContent = error.message || "The compiler request failed. Please try again.";
    consoleOutput.classList.add("is-error");
    setStatus("Unable to run code", "error");
  } finally {
    isRunning = false;
    resetButton.disabled = false;
    clearOutputButton.disabled = false;
    backButton.disabled = false;
    document.querySelectorAll(".language-tab").forEach((button) => { button.disabled = false; });
    workspace.removeAttribute("aria-busy");
    updateRunButton();
  }
}

languageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.language;
    if (button.classList.contains("language-card")) {
      showWorkspace(key);
    } else {
      updateLanguage(key);
    }
  });
});

runButton.addEventListener("click", runCode);
resetButton.addEventListener("click", () => {
  if (!activeLanguage || isRunning) return;
  editor.setValue(languageConfig[activeLanguage].defaultCode);
  codeByLanguage[activeLanguage] = languageConfig[activeLanguage].defaultCode;
  consoleOutput.textContent = "Run your code to see output here.";
  consoleOutput.classList.remove("is-error");
  setStatus("Code reset to the starter program");
});
clearOutputButton.addEventListener("click", () => {
  consoleOutput.textContent = "";
  consoleOutput.classList.remove("is-error");
  setStatus("Console cleared");
});
backButton.addEventListener("click", () => {
  if (isRunning) return;
  workspace.hidden = true;
  languagePicker.hidden = false;
});
