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
    output: [
      'Enumerating objects: 3, done.',
      'Counting objects: 100% (3/3), done.',
      'Writing objects: 100% (3/3), 214 bytes | 214.00 KiB/s, done.',
      'Total 3 (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)',
      'To http://127.0.0.1:8090/myrepo@git.eth',
      ' * [new branch]      HEAD -> master',
    ],
  },
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
            dgit
          </div>
          <div className="desktop-menu">
            <span>Terminal</span>
            <span>Shell</span>
            <span>Edit</span>
            <span>View</span>
            <span>Window</span>
            <span>Help</span>
          </div>
          <div className="desktop-status">
            <span>22°C</span>
            <span>41%</span>
            <span>Sun May 3</span>
            <span>13:04</span>
          </div>
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
      </section>
    </main>
  )
}

export default App
