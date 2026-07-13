# thread-solar

## Getting started

Each person runs the app on their **own machine** — you cannot open a teammate's
`localhost` from your computer. Follow these steps to run it locally.

**Prerequisites:** [Node.js](https://nodejs.org) 18+ and npm.

```bash
# 1. Clone the repo (or `git pull` if you already have it)
git clone https://github.com/ysclaireshin/Thread.git
cd Thread            # folder name may be thread-solar depending on your clone

# 2. Install dependencies
npm install

# 3. Set up your API keys
cp .env.example .env.local
# then open .env.local and paste your own ANTHROPIC_API_KEY and GROQ_API_KEY
# (see .env.example for where to get them)

# 4. Start the dev server
npm run dev
```

The app runs at **http://localhost:5181** (configured in `vite.config.ts`).
Open that URL in your browser — not 1581 or any other port.

**Troubleshooting**

- **AI cards show errors / faults:** you're missing keys in `.env.local`. Copy
  `.env.example`, fill in both `ANTHROPIC_API_KEY` and `GROQ_API_KEY`, then restart `npm run dev`.
- **Blank page or old behavior:** run `git pull` to get the latest code, then
  `npm install` again in case dependencies changed.
- **Port already in use:** stop whatever is on 5181, or change the `port` in `vite.config.ts`.

---

## About the template

This project was bootstrapped with React + TypeScript + Vite (HMR + ESLint).

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
