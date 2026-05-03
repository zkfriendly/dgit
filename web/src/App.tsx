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

type DesktopWindow =
  | 'terminal'
  | 'quickStart'
  | 'pushPull'
  | 'poster'
  | 'browser'
  | 'reliability'

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

const quickStartCommands = [
  {
    id: 'clone',
    label: '0. Clone the git repo',
    command: 'git clone git@github.com:zkfriendly/dgit.git',
  },
  {
    id: 'build',
    label: '2. Build the image',
    command: 'docker build -t dgit .',
  },
  {
    id: 'run',
    label: '3. Run dgit',
    command:
      'docker run --rm \\\n' +
      '  -p 8090:8090 \\\n' +
      '  -v dgit-data:/data \\\n' +
      '  -e PRIVATE_KEY="$PRIVATE_KEY" \\\n' +
      '  dgit',
  },
]

const pushPullCommands = [
  {
    id: 'pushpull-remote',
    label: '1. Add the dgit remote',
    command: 'git remote add origin http://127.0.0.1:8090/myrepo@git.eth',
  },
  {
    id: 'pushpull-push',
    label: '2. Push your branch',
    command: 'git push origin HEAD:master',
  },
  {
    id: 'pushpull-clone',
    label: '3. Clone the repo',
    command: 'git clone http://127.0.0.1:8090/myrepo@git.eth',
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
  const [isPushPullOpen, setIsPushPullOpen] = useState(false)
  const [isPosterOpen, setIsPosterOpen] = useState(false)
  const [isBrowserOpen, setIsBrowserOpen] = useState(false)
  const [isReliabilityOpen, setIsReliabilityOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
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
  const pushPullClickRef = useRef(0)
  const posterClickRef = useRef(0)
  const browserClickRef = useRef(0)
  const reliabilityClickRef = useRef(0)
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
  const isTextFileActive =
    (isQuickStartOpen && activeWindow === 'quickStart') ||
    (isPushPullOpen && activeWindow === 'pushPull')
  const isPosterActive = isPosterOpen && activeWindow === 'poster'
  const isBrowserActive =
    (isBrowserOpen && activeWindow === 'browser') ||
    (isReliabilityOpen && activeWindow === 'reliability')
  const appName = isTextFileActive
    ? 'TextEdit'
    : isPosterActive
      ? 'Preview'
      : isBrowserActive
        ? 'Brave Browser'
        : 'Terminal'
  const menuItems = isTextFileActive
    ? ['File', 'Edit', 'Format', 'View', 'Window', 'Help']
    : isPosterActive
      ? ['File', 'Edit', 'View', 'Tools', 'Window', 'Help']
      : isBrowserActive
        ? ['File', 'Edit', 'View', 'History', 'Bookmarks', 'Window', 'Help']
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

  const openPushPull = () => {
    setIsPushPullOpen(true)
    setActiveWindow('pushPull')
  }

  const openPoster = () => {
    setIsPosterOpen(true)
    setActiveWindow('poster')
  }

  const openBrowser = () => {
    setIsBrowserOpen(true)
    setActiveWindow('browser')
  }

  const openReliability = () => {
    setIsReliabilityOpen(true)
    setActiveWindow('reliability')
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

  const handlePushPullPointerUp = () => {
    const clickedAt = Date.now()

    if (clickedAt - pushPullClickRef.current < 450) {
      openPushPull()
      pushPullClickRef.current = 0
      return
    }

    pushPullClickRef.current = clickedAt
  }

  const handlePosterPointerUp = () => {
    const clickedAt = Date.now()

    if (clickedAt - posterClickRef.current < 450) {
      openPoster()
      posterClickRef.current = 0
      return
    }

    posterClickRef.current = clickedAt
  }

  const handleBrowserPointerUp = () => {
    const clickedAt = Date.now()

    if (clickedAt - browserClickRef.current < 450) {
      openBrowser()
      browserClickRef.current = 0
      return
    }

    browserClickRef.current = clickedAt
  }

  const handleReliabilityPointerUp = () => {
    const clickedAt = Date.now()

    if (clickedAt - reliabilityClickRef.current < 450) {
      openReliability()
      reliabilityClickRef.current = 0
      return
    }

    reliabilityClickRef.current = clickedAt
  }

  const copyCommand = async (id: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(id)
      window.setTimeout(() => setCopiedCommand(null), 1200)
    } catch (error) {
      console.error('Failed to copy command', error)
    }
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

          <button
            className="desktop-file-icon desktop-pushpull-icon"
            onDoubleClick={openPushPull}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                openPushPull()
              }
            }}
            onPointerUp={handlePushPullPointerUp}
            type="button"
          >
            <span />
            <p>push&pull</p>
          </button>

          <button
            className="desktop-image-icon"
            onDoubleClick={openPoster}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                openPoster()
              }
            }}
            onPointerUp={handlePosterPointerUp}
            type="button"
          >
            <span />
            <p>dgit poster</p>
          </button>

          <button
            className="desktop-browser-icon"
            onDoubleClick={openBrowser}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                openBrowser()
              }
            }}
            onPointerUp={handleBrowserPointerUp}
            type="button"
          >
            <span>
              <img
                alt=""
                src="https://api.iconify.design/logos:brave.svg"
              />
            </span>
            <p>github down 2026</p>
          </button>

          <button
            className="desktop-browser-icon desktop-reliability-icon"
            onDoubleClick={openReliability}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                openReliability()
              }
            }}
            onPointerUp={handleReliabilityPointerUp}
            type="button"
          >
            <span>
              <img
                alt=""
                src="https://api.iconify.design/logos:brave.svg"
              />
            </span>
            <p>Github: Reliability Crisis</p>
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
                      bottom: 'auto',
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
              <div className="quick-start-content">
                {quickStartCommands.slice(0, 1).map((item) => (
                  <section className="quick-start-step" key={item.id}>
                    <p>{item.label}</p>
                    <div className="command-snippet">
                      <pre>
                        <code>$ {item.command}</code>
                      </pre>
                      <button
                        aria-label={`Copy ${item.label} command`}
                        className="copy-command-button"
                        onClick={() => copyCommand(item.id, item.command)}
                        type="button"
                      >
                        {copiedCommand === item.id ? 'copied' : 'copy'}
                      </button>
                    </div>
                  </section>
                ))}

                <section className="quick-start-step">
                  <p>1. Install Docker</p>
                  <a href="https://docs.docker.com/get-docker/">docs.docker.com/get-docker</a>
                </section>

                {quickStartCommands.slice(1).map((item) => (
                  <section className="quick-start-step" key={item.id}>
                    <p>{item.label}</p>
                    <div className="command-snippet">
                      <pre>
                        <code>
                          {item.command
                            .split('\n')
                            .map((line, index) => (index === 0 ? `$ ${line}` : `  ${line}`))
                            .join('\n')}
                        </code>
                      </pre>
                      <button
                        aria-label={`Copy ${item.label} command`}
                        className="copy-command-button"
                        onClick={() => copyCommand(item.id, item.command)}
                        type="button"
                      >
                        {copiedCommand === item.id ? 'copied' : 'copy'}
                      </button>
                    </div>
                  </section>
                ))}

                <p className="private-key-note">
                  PRIVATE_KEY is the wallet private key used to claim new *.git.eth repo names
                  on ENS.
                </p>
              </div>
            </article>
          )}

          {isPushPullOpen && (
            <article
              className={`quick-start-window push-pull-window ${
                windowPositions.pushPull ? 'is-dragged' : ''
              }`}
              aria-label="push and pull text file"
              data-window
              onPointerDown={() => setActiveWindow('pushPull')}
              style={{
                ...(windowPositions.pushPull
                  ? {
                      left: windowPositions.pushPull.x,
                      right: 'auto',
                      top: windowPositions.pushPull.y,
                      bottom: 'auto',
                    }
                  : {}),
                zIndex: activeWindow === 'pushPull' ? 5 : 3,
              }}
            >
              <div
                className="quick-start-titlebar window-drag-handle"
                onPointerDown={(event) => startDrag('pushPull', event)}
                onPointerMove={dragWindow}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                <div className="window-controls">
                  <button
                    aria-label="Close push and pull"
                    onClick={() => setIsPushPullOpen(false)}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  />
                  <span />
                  <span />
                </div>
                <strong>push&pull.txt</strong>
              </div>
              <div className="quick-start-content">
                {pushPullCommands.map((item) => (
                  <section className="quick-start-step" key={item.id}>
                    <p>{item.label}</p>
                    <div className="command-snippet">
                      <pre>
                        <code>$ {item.command}</code>
                      </pre>
                      <button
                        aria-label={`Copy ${item.label} command`}
                        className="copy-command-button"
                        onClick={() => copyCommand(item.id, item.command)}
                        type="button"
                      >
                        {copiedCommand === item.id ? 'copied' : 'copy'}
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            </article>
          )}

          {isBrowserOpen && (
            <article
              className={`browser-window ${windowPositions.browser ? 'is-dragged' : ''}`}
              aria-label="Brave browser showing GitHub availability article"
              data-window
              onPointerDown={() => setActiveWindow('browser')}
              style={{
                ...(windowPositions.browser
                  ? {
                      left: windowPositions.browser.x,
                      right: 'auto',
                      top: windowPositions.browser.y,
                      bottom: 'auto',
                    }
                  : {}),
                zIndex: activeWindow === 'browser' ? 5 : 3,
              }}
            >
              <div
                className="browser-titlebar window-drag-handle"
                onPointerDown={(event) => startDrag('browser', event)}
                onPointerMove={dragWindow}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                <div className="window-controls">
                  <button
                    aria-label="Close browser"
                    onClick={() => setIsBrowserOpen(false)}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  />
                  <span />
                  <span />
                </div>
                <div className="browser-url-bar">
                  <span>https://github.blog/news-insights/company-news/an-update-on-github-availability/</span>
                </div>
                <strong>Brave</strong>
              </div>
              <div className="browser-content">
                <img
                  alt="GitHub availability article shown in Brave"
                  src="/github-availability.png"
                />
              </div>
            </article>
          )}

          {isReliabilityOpen && (
            <article
              className={`browser-window reliability-window ${
                windowPositions.reliability ? 'is-dragged' : ''
              }`}
              aria-label="Brave browser showing GitHub reliability crisis article"
              data-window
              onPointerDown={() => setActiveWindow('reliability')}
              style={{
                ...(windowPositions.reliability
                  ? {
                      left: windowPositions.reliability.x,
                      right: 'auto',
                      top: windowPositions.reliability.y,
                      bottom: 'auto',
                    }
                  : {}),
                zIndex: activeWindow === 'reliability' ? 5 : 3,
              }}
            >
              <div
                className="browser-titlebar window-drag-handle"
                onPointerDown={(event) => startDrag('reliability', event)}
                onPointerMove={dragWindow}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                <div className="window-controls">
                  <button
                    aria-label="Close browser"
                    onClick={() => setIsReliabilityOpen(false)}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  />
                  <span />
                  <span />
                </div>
                <div className="browser-url-bar">
                  <span>https://byteiota.com/ghostty-leaves-github-after-18-years-reliability-crisis/</span>
                </div>
                <strong>Brave</strong>
              </div>
              <div className="browser-content">
                <img
                  alt="GitHub reliability crisis article shown in Brave"
                  src="/github-reliability-crisis.png"
                />
              </div>
            </article>
          )}

          {isPosterOpen && (
            <article
              className={`poster-window ${windowPositions.poster ? 'is-dragged' : ''}`}
              aria-label="dgit poster image preview"
              data-window
              onPointerDown={() => setActiveWindow('poster')}
              style={{
                ...(windowPositions.poster
                  ? {
                      left: windowPositions.poster.x,
                      right: 'auto',
                      top: windowPositions.poster.y,
                    }
                  : {}),
                zIndex: activeWindow === 'poster' ? 5 : 3,
              }}
            >
              <div
                className="poster-titlebar window-drag-handle"
                onPointerDown={(event) => startDrag('poster', event)}
                onPointerMove={dragWindow}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                <div className="window-controls">
                  <button
                    aria-label="Close poster"
                    onClick={() => setIsPosterOpen(false)}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  />
                  <span />
                  <span />
                </div>
                <strong>cover_image_dgit.png</strong>
              </div>
              <img
                alt="dgit decentralized git forge poster"
                className="poster-preview-image"
                src="/cover_image_dgit.png"
              />
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

          <div className="desktop-logo-mark" aria-label="dgit logo">
            <img alt="" src="/logo_dgit.png" />
            <p>dgit</p>
          </div>

          <aside className="protocol-badge" aria-label="AXL and ENS project note">
            <span>AXL x ENS</span>
            <strong>peer-routed repos</strong>
            <p>names resolve onchain, git moves off-server</p>
          </aside>

          <nav className="desktop-dock" aria-label="Desktop dock">
            {[
              ['finder', 'Finder', 'https://api.iconify.design/streamline-logos:mac-finder-logo.svg'],
              ['calendar', 'Calendar', 'https://api.iconify.design/fluent-emoji-flat:calendar.svg'],
              ['vscode', 'VS Code', 'https://api.iconify.design/logos:visual-studio-code.svg'],
              ['docker', 'Docker', 'https://api.iconify.design/logos:docker-icon.svg'],
              [
                'terminal',
                'Terminal',
                'https://api.iconify.design/material-symbols:terminal-rounded.svg?color=%23ffffff',
              ],
              ['browser', 'Browser', 'https://api.iconify.design/logos:brave.svg'],
              ['notes', 'Notes', 'https://api.iconify.design/fluent-emoji-flat:spiral-notepad.svg'],
              ['chat', 'ChatGPT', 'https://api.iconify.design/logos:openai-icon.svg'],
              ['folder', 'Files', 'https://api.iconify.design/fluent-emoji-flat:open-file-folder.svg'],
            ].map(([id, label, icon]) => (
              <button className={`dock-app dock-app-${id}`} key={id} type="button">
                <span>
                  <img alt="" src={icon} />
                </span>
                <p>{label}</p>
              </button>
            ))}
          </nav>
        </div>
      </section>
    </main>
  )
}

export default App
