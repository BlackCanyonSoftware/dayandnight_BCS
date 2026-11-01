import js from "@eslint/js";
import globals from "globals";

/**
 * Architecture invariant 1: the scene is a pure function of its inputs. The
 * engine may not read the clock or an unseeded random number, so the three
 * calls that would let it are refused here rather than left to vigilance.
 * See docs/adr/0005-stateless-scene-independent-windows.md.
 */
const NO_AMBIENT_STATE = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message:
      "The engine must not read the clock. Take the timestamp as the `t` argument instead (architecture invariant 1)."
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      "The engine must not read the clock. Take the timestamp as the `t` argument instead (architecture invariant 1)."
  },
  {
    selector: "MemberExpression[object.name='performance'][property.name='now']",
    message:
      "The engine must not read the clock. Take the timestamp as the `t` argument instead (architecture invariant 1)."
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message:
      "The engine must be deterministic. Seed a hash from the inputs instead (architecture invariant 1)."
  },
  {
    selector: "CallExpression[callee.name=/^(setTimeout|setInterval|requestAnimationFrame)$/]",
    message:
      "The engine never decides when to draw. The host calls render() (architecture invariant 2)."
  }
];

export default [
  {
    // app/brand is a brandkit bundle: generated files, verified by hash, and
    // not ours to fix. Its template/ carries a UI shell this application does
    // not use.
    ignores: [
      "node_modules/**",
      "dist/**",
      "playwright-report/**",
      "test-results/**",
      "app/brand/**"
    ]
  },

  js.configs.recommended,

  {
    rules: {
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },

  /* The web app: browser globals, ES modules. */
  {
    files: ["app/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser }
    }
  },

  /* The engine: the invariants above, and no DOM. */
  {
    files: ["app/engine/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {}
    },
    rules: {
      "no-restricted-syntax": ["error", ...NO_AMBIENT_STATE],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "The engine never touches the DOM (architecture invariant 2)." },
        {
          name: "document",
          message: "The engine never touches the DOM (architecture invariant 2)."
        },
        {
          name: "fetch",
          message: "The engine never touches the network (architecture invariant 2)."
        }
      ]
    }
  },

  /* These tools drive a real browser, so their evaluate() callbacks are
     serialised and run in the page. Node globals plus browser globals, the
     same as a test. */
  {
    files: ["tools/measure-cost.js", "tools/verify-package.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser }
    }
  },

  /* The Electron shell: Node globals, CommonJS. */
  {
    files: ["desktop/**/*.js", "tools/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node }
    }
  },

  /* Tests. Both sets of globals: a test file is Node, but the callbacks it
     hands to page.evaluate() are serialised and run in the browser. */
  {
    files: ["tests/**/*.{js,mjs}", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser }
    }
  }
];
