import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
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

type DesktopWindow = 'terminal' | 'quickStart'

type Point = {
  x: number
  y: number
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
    output: ['Initialized empty Git repository in /Users/ponyo/Desktop/myrepo/.git/'],
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
  const [isQuickStartOpen, setIsQuickStartOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [activeWindow, setActiveWindow] = useState<DesktopWindow>('terminal')
  const [windowPositions, setWindowPositions] = useState<Partial<Record<DesktopWindow, Point>>>(
    {},
  )
  const [commandIndex, setCommandIndex] = useState(
    reduceMotion ? demoSteps.length : 0,
  )
  const [characterIndex, setCharacterIndex] = useState(0)
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>(
    reduceMotion ? fullDemoLines : [],
  )
  const [showRepoFolder, setShowRepoFolder] = useState(reduceMotion)
  const desktopStageRef = useRef<HTMLDivElement>(null)
  const terminalBodyRef = useRef<HTMLDivElement>(null)
  const quickStartClickRef = useRef(0)
  const dragRef = useRef<{
    id: DesktopWindow
    offsetX: number
    offsetY: number
    width: number
    height: number
  } | null>(null)

  const activeStep = demoSteps[commandIndex]
  const activeCommand = activeStep?.command ?? ''
  const typedCommand = activeCommand.slice(0, characterIndex)
  const isTextFileActive = isQuickStartOpen && activeWindow === 'quickStart'
  const appName = isTextFileActive ? 'TextEdit' : 'Terminal'
  const menuItems = isTextFileActive
    ? ['File', 'Edit', 'Format', 'View', 'Window', 'Help']
    : ['Shell', 'Edit', 'View', 'Window', 'Help']
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  const openQuickStart = () => {
    setIsQuickStartOpen(true)
    setActiveWindow('quickStart')
  }

  const handleQuickStartPointerUp = () => {
    const clickedAt = Date.now()

    if (clickedAt - quickStartClickRef.current < 450) {
      openQuickStart()
      quickStartClickRef.current = 0
      return
    }

    quickStartClickRef.current = clickedAt
  }

  const startDrag = (id: DesktopWindow, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }

    const stage = desktopStageRef.current
    if (!stage) {
      return
    }

    const windowElement = event.currentTarget.closest<HTMLElement>('[data-window]')
    if (!windowElement) {
      return
    }

    const stageRect = stage.getBoundingClientRect()
    const windowRect = windowElement.getBoundingClientRect()

    setActiveWindow(id)
    dragRef.current = {
      id,
      offsetX: event.clientX - windowRect.left,
      offsetY: event.clientY - windowRect.top,
      width: windowRect.width,
      height: windowRect.height,
    }

    setWindowPositions((positions) => ({
      ...positions,
      [id]: {
        x: windowRect.left - stageRect.left,
        y: windowRect.top - stageRect.top,
      },
    }))

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const dragWindow = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const stage = desktopStageRef.current
    if (!drag || !stage) {
      return
    }

    const stageRect = stage.getBoundingClientRect()
    const maxX = Math.max(0, stageRect.width - drag.width)
    const maxY = Math.max(0, stageRect.height - drag.height)
    const x = Math.min(Math.max(0, event.clientX - stageRect.left - drag.offsetX), maxX)
    const y = Math.min(Math.max(0, event.clientY - stageRect.top - drag.offsetY), maxY)

    setWindowPositions((positions) => ({
      ...positions,
      [drag.id]: { x, y },
    }))
  }

  const stopDrag = () => {
    dragRef.current = null
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(interval)
  }, [])

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
            {appName}
          </div>
          <div className="desktop-menu">
            {menuItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="desktop-status">
            <span>22°C</span>
            <span>41%</span>
            <span>{dateLabel}</span>
            <span>{timeLabel}</span>
          </div>
        </div>

        <div
          className="desktop-stage"
          aria-label="Animated dgit desktop demo"
          ref={desktopStageRef}
        >
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

          <button
            className="desktop-file-icon"
            onDoubleClick={openQuickStart}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                openQuickStart()
              }
            }}
            onPointerUp={handleQuickStartPointerUp}
            type="button"
          >
            <span />
            <p>quick start</p>
          </button>

          {isQuickStartOpen && (
            <article
              className={`quick-start-window ${
                windowPositions.quickStart ? 'is-dragged' : ''
              }`}
              aria-label="quick start text file"
              data-window
              onPointerDown={() => setActiveWindow('quickStart')}
              style={{
                ...(windowPositions.quickStart
                  ? {
                      left: windowPositions.quickStart.x,
                      right: 'auto',
                      top: windowPositions.quickStart.y,
                    }
                  : {}),
                zIndex: activeWindow === 'quickStart' ? 5 : 3,
              }}
            >
              <div
                className="quick-start-titlebar window-drag-handle"
                onPointerDown={(event) => startDrag('quickStart', event)}
                onPointerMove={dragWindow}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                <div className="window-controls">
                  <button
                    aria-label="Close quick start"
                    onClick={() => setIsQuickStartOpen(false)}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  />
                  <span />
                  <span />
                </div>
                <strong>quick start.txt</strong>
              </div>
              <pre>{`0. Clone the git repo
   $ git clone git@github.com:zkfriendly/dgit.git

1. Install Docker
   https://docs.docker.com/get-docker/

2. Build the image
   $ docker build -t dgit .

3. Run dgit
   $ docker run --rm \\
       -p 8090:8090 \\
       -v dgit-data:/data \\
       -e PRIVATE_KEY="$PRIVATE_KEY" \\
       dgit

PRIVATE_KEY is the wallet private key used to claim new *.git.eth
repo names on ENS.
`}</pre>
            </article>
          )}

          <div
            className={`demo-terminal ${windowPositions.terminal ? 'is-dragged' : ''}`}
            aria-label="Terminal demo"
            data-window
            onPointerDown={() => setActiveWindow('terminal')}
            style={{
              ...(windowPositions.terminal
                ? {
                    left: windowPositions.terminal.x,
                    top: windowPositions.terminal.y,
                  }
                : {}),
              zIndex: activeWindow === 'terminal' ? 5 : 2,
            }}
          >
            <div
              className="terminal-header window-drag-handle"
              onPointerDown={(event) => startDrag('terminal', event)}
              onPointerMove={dragWindow}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
            >
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
