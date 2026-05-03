import { useEffect, useRef, useState } from 'react'
import './App.css'

type DemoStep = {
  cwd: string
  branch?: string
  dirty?: boolean
  command: string
  output: string[]
}

type TerminalLine =
  | {
      kind: 'command'
      step: DemoStep
    }
  | {
      kind: 'output'
      text: string
    }

const demoSteps: DemoStep[] = [
  {
    cwd: 'Desktop',
    command: 'mkdir myrepo && cd myrepo',
    output: [],
  },
  {
    cwd: 'myrepo',
    command: 'git init',
    output: ['Initialized empty Git repository in /Users/thefazi/Desktop/myrepo/.git/'],
  },
  {
    cwd: 'myrepo',
    branch: 'main',
    command: 'echo "Hello, World!" >> hello.txt',
    output: [],
  },
  {
    cwd: 'myrepo',
    branch: 'main',
    dirty: true,
    command: 'git add . && git commit -m "first commit"',
    output: [
      '[main (root-commit) 5618706] first commit',
      ' 1 file changed, 1 insertion(+)',
      ' create mode 100644 hello.txt',
    ],
  },
  {
    cwd: 'myrepo',
    branch: 'main',
    command: 'git remote add origin http://127.0.0.1:8090/myrepo@git.eth',
    output: [],
  },
  {
    cwd: 'myrepo',
    branch: 'main',
    command: 'git push origin HEAD:master',
    output: [],
  },
]

const runSteps = [
  {
    command: 'docker build -t dgit-home ./web',
    label: 'Build the homepage image',
  },
  {
    command: 'docker run --rm -p 8080:80 dgit-home',
    label: 'Open the guide at http://localhost:8080',
  },
  {
    command: 'cd node && zig build',
    label: 'Build Haxy, the git smart HTTP server',
  },
  {
    command: 'cd axl && make build && ./node -config node-config.json',
    label: 'Start the AXL peer-to-peer transport',
  },
  {
    command: 'python3 scripts/dgit_axl_bridge.py --listen 127.0.0.1:8090',
    label: 'Bridge ENS repo names to Haxy over AXL',
  },
]

const backgroundFlow = [
  ['git push', 'Developer pushes to repo@git.eth'],
  ['ENS', 'Resolve or claim the repo identity'],
  ['AXL', 'Route bytes to the peer public key'],
  ['Haxy', 'Serve git smart HTTP locally'],
  ['git pull', 'Another peer fetches the repo'],
]

const fullDemoLines = demoSteps.flatMap<TerminalLine>((step) => [
  {
    kind: 'command',
    step,
  },
  ...step.output.map((text) => ({
    kind: 'output' as const,
    text,
  })),
])

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function TerminalPrompt({
  command,
  step,
}: {
  command: string
  step: DemoStep
}) {
  return (
    <>
      <span className="prompt-arrow">➜</span>
      <span className="prompt-cwd">{step.cwd}</span>
      {step.branch && (
        <>
          <span className="prompt-git">git:</span>
          <span className="prompt-branch">({step.branch})</span>
        </>
      )}
      {step.dirty && <span className="prompt-dirty">✗</span>}
      <span className="terminal-command">{command}</span>
    </>
  )
}

function App() {
  const reduceMotion = prefersReducedMotion()
  const [commandIndex, setCommandIndex] = useState(
    reduceMotion ? demoSteps.length : 0,
  )
  const [characterIndex, setCharacterIndex] = useState(0)
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>(
    reduceMotion ? fullDemoLines : [],
  )
  const [showRepoFolder, setShowRepoFolder] = useState(reduceMotion)
  const terminalBodyRef = useRef<HTMLDivElement>(null)

  const activeStep = demoSteps[commandIndex]
  const activeCommand = activeStep?.command ?? ''
  const typedCommand = activeCommand.slice(0, characterIndex)

  useEffect(() => {
    if (commandIndex >= demoSteps.length) {
      const timeout = window.setTimeout(() => {
        setTerminalLines([])
        setShowRepoFolder(false)
        setCommandIndex(0)
        setCharacterIndex(0)
      }, 1400)

      return () => window.clearTimeout(timeout)
    }

    const step = demoSteps[commandIndex]

    if (characterIndex < step.command.length) {
      const delay = 34 + ((characterIndex + commandIndex) % 5) * 18
      const timeout = window.setTimeout(() => {
        setCharacterIndex((current) => current + 1)
      }, delay)

      return () => window.clearTimeout(timeout)
    }

    const timeout = window.setTimeout(() => {
      setTerminalLines((lines) => [
        ...lines,
        {
          kind: 'command',
          step,
        },
        ...step.output.map((text) => ({
          kind: 'output' as const,
          text,
        })),
      ])

      if (commandIndex === 0) {
        setShowRepoFolder(true)
      }

      setCommandIndex((current) => current + 1)
      setCharacterIndex(0)
    }, 520)

    return () => window.clearTimeout(timeout)
  }, [characterIndex, commandIndex])

  useEffect(() => {
    terminalBodyRef.current?.scrollTo({
      top: terminalBodyRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [characterIndex, terminalLines])

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="desktop-bar">
          <div className="desktop-brand">
            <span className="branch-dot" />
            dgit demo
          </div>
          <div className="desktop-menu">
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span>Terminal</span>
          </div>
          <div className="desktop-clock">11:49 AM</div>
        </div>

        <div className="desktop-stage" aria-label="Animated dgit desktop demo">
          <div className="desktop-folders">
            <div className="folder-icon">
              <span />
              <p>projects</p>
            </div>
            <div className="folder-icon">
              <span />
              <p>notes</p>
            </div>
            <div className={`folder-icon repo-folder ${showRepoFolder ? 'visible' : ''}`}>
              <span />
              <p>myrepo</p>
            </div>
          </div>

          <div className="demo-terminal" aria-label="Terminal demo">
            <div className="terminal-header">
              <span />
              <span />
              <span />
              <strong>terminal - dgit demo</strong>
            </div>
            <div className="terminal-body" ref={terminalBodyRef}>
              {terminalLines.map((line, index) => (
                <p
                  className={line.kind === 'command' ? 'prompt-line' : 'output-line'}
                  key={`${line.kind}-${index}`}
                >
                  {line.kind === 'command' ? (
                    <TerminalPrompt command={line.step.command} step={line.step} />
                  ) : (
                    line.text
                  )}
                </p>
              ))}
              {activeStep && (
                <p className="prompt-line active-line">
                  <TerminalPrompt command={typedCommand} step={activeStep} />
                  <span className="cursor" />
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="hero-intro">
          <div className="hero-copy">
            <p className="kicker">dgit homepage</p>
            <h1>A small guide for running a decentralized git forge.</h1>
            <p className="hero-text">
              dgit connects Haxy, AXL, and ENS so a normal git remote can point
              at a peer-owned repo name instead of a centralized forge.
            </p>

            <div className="hero-actions">
              <a href="#run" className="button primary">
                Run it
              </a>
              <a href="#flow" className="button secondary">
                See the flow
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="run">
        <div className="section-heading">
          <p className="kicker">quick start</p>
          <h2>Clone, build, run.</h2>
          <p>
            The homepage is a standalone React app. Docker serves the production
            build with nginx so anyone can download the repo and open the guide.
          </p>
        </div>

        <div className="command-list">
          {runSteps.map((step) => (
            <article className="command-card" key={step.command}>
              <p>{step.label}</p>
              <code>{step.command}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="section split" id="flow">
        <div className="section-heading">
          <p className="kicker">background</p>
          <h2>What happens after a git command?</h2>
          <p>
            The bridge keeps git familiar while the identity and transport move
            behind the scenes.
          </p>
        </div>

        <div className="flow">
          {backgroundFlow.map(([title, body]) => (
            <article className="flow-step" key={title}>
              <div className="commit-node" />
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section feature-grid">
        <article>
          <p className="kicker">Haxy</p>
          <h3>Git server</h3>
          <p>Accepts smart HTTP pushes and pulls against local repositories.</p>
        </article>
        <article>
          <p className="kicker">AXL</p>
          <h3>P2P routing</h3>
          <p>Moves raw git traffic between peers through a local HTTP API.</p>
        </article>
        <article>
          <p className="kicker">ENS</p>
          <h3>Repo identity</h3>
          <p>Maps repo-style names to the AXL public key that owns the forge.</p>
        </article>
      </section>

      <section className="footer-cta">
        <div>
          <p className="kicker">next command</p>
          <h2>git clone, then run the guide.</h2>
        </div>
        <code>npm run dev -- --host 0.0.0.0</code>
      </section>
    </main>
  )
}

export default App
