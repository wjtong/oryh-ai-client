import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Caption1,
  Card,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  FluentProvider,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Text,
  Title1,
  Title2,
  Tooltip,
  makeStyles,
  tokens,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components'
import {
  IconArrowUpRight,
  IconBuilding,
  IconChecklist,
  IconCopy,
  IconDeviceDesktop,
  IconExternalLink,
  IconFolder,
  IconRefresh,
  IconReceipt,
  IconDeviceFloppy,
  IconLogout,
  IconShieldCheck,
  IconUserPlus,
} from '@tabler/icons-react'
import type {
  ConnectionSummary,
  OryhExpenseClaim,
  OryhOperationResult,
  OryhProject,
  OryhTodo,
  OperationDefinition,
  OperationId,
  SavedOperationView,
} from '@oryh/ai-client-core'
import { OryhWorkspace, type OryhWorkspaceSnapshot } from '@oryh/ai-client-workspace'
import { format, zhCN as copy } from './copy.js'
import { LocalOryhRemote, LocalRemoteError } from './remote.js'

const useStyles = makeStyles({
  root: {
    minHeight: '100dvh',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
  },
  shell: {
    minHeight: '100dvh',
    display: 'grid',
    gridTemplateColumns: '252px minmax(0, 1fr)',
    '@media (max-width: 767px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    padding: '24px 16px',
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    '@media (max-width: 767px)': {
      borderRight: 'none',
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: '16px',
    },
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 8px',
  },
  brandMark: {
    width: '32px',
    height: '32px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: '8px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  navGroup: {
    display: 'grid',
    gap: '4px',
  },
  navLabel: {
    padding: '0 10px 6px',
    color: tokens.colorNeutralForeground3,
  },
  navButton: {
    justifyContent: 'flex-start',
  },
  sidebarFooter: {
    display: 'grid',
    gap: '12px',
    marginTop: 'auto',
    padding: '12px 8px 4px',
  },
  connectionSummary: {
    display: 'grid',
    gap: '4px',
  },
  main: {
    width: '100%',
    maxWidth: '1440px',
    margin: '0 auto',
    padding: '28px 32px 48px',
    '@media (max-width: 767px)': {
      padding: '20px 16px 32px',
    },
  },
  topbar: {
    minHeight: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '32px',
    '@media (max-width: 767px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
      marginBottom: '24px',
    },
  },
  topbarActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  select: {
    minWidth: '210px',
  },
  intro: {
    display: 'grid',
    gap: '8px',
    maxWidth: '760px',
    marginBottom: '28px',
  },
  workspace: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, .75fr)',
    gap: '20px',
    alignItems: 'start',
    '@media (max-width: 1023px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  primaryColumn: {
    display: 'grid',
    gap: '20px',
  },
  sideColumn: {
    display: 'grid',
    gap: '20px',
  },
  card: {
    display: 'grid',
    gap: '16px',
    padding: '22px',
    borderRadius: '12px',
    boxShadow: tokens.shadow4,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
  },
  cardTitle: {
    display: 'grid',
    gap: '4px',
  },
  actionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 520px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  operationButton: {
    minHeight: '76px',
    justifyContent: 'flex-start',
    textAlign: 'left',
  },
  operationButtonContent: {
    display: 'grid',
    gap: '4px',
    justifyItems: 'start',
  },
  resultToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  projectGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '12px',
    '@media (max-width: 640px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  project: {
    display: 'grid',
    gap: '10px',
    padding: '16px',
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  projectMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    color: tokens.colorNeutralForeground3,
  },
  todoGrid: {
    display: 'grid',
    gap: '10px',
  },
  todo: {
    display: 'grid',
    gap: '8px',
    padding: '16px',
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  todoTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
  },
  savedList: {
    display: 'grid',
    gap: '10px',
  },
  savedAction: {
    display: 'grid',
    gap: '8px',
    padding: '14px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  savedActionLast: {
    borderBottom: 'none',
  },
  empty: {
    display: 'grid',
    gap: '8px',
    justifyItems: 'start',
    padding: '12px 0',
    color: tokens.colorNeutralForeground3,
  },
  connectForm: {
    display: 'grid',
    gap: '16px',
    maxWidth: '520px',
  },
  approval: {
    display: 'grid',
    gap: '16px',
    padding: '18px',
    borderRadius: '10px',
    backgroundColor: tokens.colorBrandBackground2,
  },
  code: {
    width: 'fit-content',
    padding: '8px 12px',
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    letterSpacing: '0.08em',
  },
  inlineStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  saveForm: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '10px',
    alignItems: 'end',
    '@media (max-width: 520px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
})

type BusyAction = 'load' | 'connect' | 'disconnect' | 'run' | 'save' | undefined

/** Render the local, no-model ORYH workbench. */
export function App(): ReactNode {
  const styles = useStyles()
  const workspace = useMemo(() => new OryhWorkspace(new LocalOryhRemote()), [])
  const [snapshot, setSnapshot] = useState<OryhWorkspaceSnapshot>(() => workspace.snapshot())
  const [busy, setBusy] = useState<BusyAction>('load')
  const [error, setError] = useState<string | undefined>()
  const [origin, setOrigin] = useState('http://127.0.0.1:8080')
  const [saveLabel, setSaveLabel] = useState('')
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [isDark, setIsDark] = useSystemTheme()
  const activeConnection = snapshot.activeConnectionId === undefined
    ? undefined
    : snapshot.connections.find(connection => connection.id === snapshot.activeConnectionId)

  const apply = useCallback(async (action: () => Promise<void>, nextBusy: BusyAction) => {
    setBusy(nextBusy)
    setError(undefined)
    try {
      await action()
      setSnapshot(workspace.snapshot())
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(undefined)
    }
  }, [workspace])

  useEffect(() => {
    void apply(async () => { await workspace.load() }, 'load')
  }, [apply, workspace])

  useEffect(() => {
    const pending = snapshot.pendingConnection
    if (pending === undefined) return
    let disposed = false
    let timer: number | undefined
    const poll = async () => {
      try {
        await workspace.pollConnection()
        if (!disposed) setSnapshot(workspace.snapshot())
      } catch (reason) {
        if (!disposed) setError(messageFor(reason))
        return
      }
      if (!disposed && workspace.snapshot().pendingConnection !== undefined) {
        timer = window.setTimeout(() => { void poll() }, pending.prompt.pollIntervalSeconds * 1000)
      }
    }
    timer = window.setTimeout(() => { void poll() }, pending.prompt.pollIntervalSeconds * 1000)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [snapshot.pendingConnection?.authorizationId, workspace])

  const run = (operationId: OperationId) => {
    void apply(async () => { await workspace.run(operationId) }, 'run')
  }

  const current = snapshot.currentResult
  const currentOperation = current === undefined ? undefined : operationById(snapshot.operations, current.operationId)

  return (
    <FluentProvider theme={isDark ? webDarkTheme : webLightTheme} className={styles.root}>
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="ORYH 工作区导航">
          <div className={styles.brand}>
            <div className={styles.brandMark} aria-hidden="true"><IconBuilding size={20} stroke={1.8} /></div>
            <div>
              <Text weight="semibold">{copy.productName}</Text><br />
              <Caption1>{copy.productDescriptor}</Caption1>
            </div>
          </div>

          <Divider />

          <nav className={styles.navGroup} aria-label="直接业务操作">
            <Caption1 className={styles.navLabel}>{copy.myWork}</Caption1>
            {snapshot.operations.map(operation => (
              <Button
                key={operation.id}
                appearance={current?.operationId === operation.id ? 'secondary' : 'subtle'}
                icon={operationIcon(operation.id)}
                className={styles.navButton}
                disabled={activeConnection === undefined || busy !== undefined}
                onClick={() => run(operation.id)}
              >
                {operation.title}
              </Button>
            ))}
          </nav>

          <div className={styles.sidebarFooter}>
            <Divider />
            <div className={styles.connectionSummary}>
              <Caption1>{copy.connection}</Caption1>
              {activeConnection === undefined ? (
                <Text size={200}>{copy.noConnection}</Text>
              ) : (
                <>
                  <Text weight="semibold">{tenantName(activeConnection)}</Text>
                  <Caption1>{activeConnection.identity.user.email}</Caption1>
                </>
              )}
            </div>
            {activeConnection !== undefined && (
              <Link href={`${activeConnection.origin}/console/dashboard`} target="_blank" rel="noreferrer">
                {copy.openConsole} <IconArrowUpRight size={14} stroke={1.8} aria-hidden="true" />
              </Link>
            )}
          </div>
        </aside>

        <main className={styles.main}>
          <header className={styles.topbar}>
            <div className={styles.inlineStatus}>
              <IconShieldCheck size={20} stroke={1.8} aria-hidden="true" />
              <Badge appearance="tint" color={activeConnection === undefined ? 'informative' : 'success'}>
                {activeConnection === undefined ? copy.noConnection : copy.connected}
              </Badge>
              {busy !== undefined && <Spinner size="tiny" aria-label={copy.loading} />}
            </div>
            <div className={styles.topbarActions}>
              {snapshot.connections.length > 1 && (
                <Select
                  aria-label={copy.chooseConnection}
                  className={styles.select}
                  value={snapshot.activeConnectionId ?? ''}
                  onChange={event => { void apply(async () => { await workspace.selectConnection(event.target.value as ConnectionSummary['id']) }, 'load') }}
                >
                  <option value="" disabled>{copy.chooseConnection}</option>
                  {snapshot.connections.map(connection => <option key={connection.id} value={connection.id}>{tenantName(connection)}</option>)}
                </Select>
              )}
              {activeConnection !== undefined && snapshot.pendingConnection === undefined && (
                <Button
                  appearance="secondary"
                  icon={<IconUserPlus size={17} stroke={1.8} />}
                  disabled={busy !== undefined}
                  onClick={() => {
                    setOrigin(activeConnection.origin)
                    void apply(async () => { await workspace.beginConnection(activeConnection.origin, copy.productName) }, 'connect')
                  }}
                >
                  {copy.connectAnotherAccount}
                </Button>
              )}
              <Tooltip content={isDark ? copy.switchToLightTheme : copy.switchToDarkTheme} relationship="label">
                <Button appearance="subtle" onClick={() => setIsDark(value => !value)}>{isDark ? '浅色' : '深色'}</Button>
              </Tooltip>
            </div>
          </header>

          {error !== undefined && (
            <MessageBar intent="error" layout="multiline">
              <MessageBarBody>{error}</MessageBarBody>
              <Button appearance="secondary" onClick={() => { void apply(async () => { await workspace.load() }, 'load') }}>{copy.retry}</Button>
            </MessageBar>
          )}

          {activeConnection !== undefined && snapshot.pendingConnection !== undefined && (
            <DeviceAuthorization
              styles={styles}
              pending={snapshot.pendingConnection}
              busy={busy}
              switchingAccount
              onCancel={() => { void apply(async () => { await workspace.cancelConnection() }, 'connect') }}
            />
          )}

          {activeConnection === undefined ? (
            <ConnectView
              styles={styles}
              origin={origin}
              pending={snapshot.pendingConnection}
              busy={busy}
              onOriginChange={setOrigin}
              onBegin={() => { void apply(async () => { await workspace.beginConnection(origin.trim(), copy.productName) }, 'connect') }}
              onCancel={() => { void apply(async () => { await workspace.cancelConnection() }, 'connect') }}
            />
          ) : (
            <>
              <section className={styles.intro} aria-labelledby="workspace-heading">
                <Caption1>{copy.directView}</Caption1>
                <Title1 id="workspace-heading">{tenantName(activeConnection)}</Title1>
                <Text>{copy.operationReadyDescription}</Text>
              </section>

              <div className={styles.workspace}>
                <div className={styles.primaryColumn}>
                  <Card className={styles.card}>
                    <CardHeader
                      title={copy.directActions}
                      description={copy.directActionsDescription}
                      icon={<IconDeviceDesktop size={22} stroke={1.7} />}
                    />
                    <div className={styles.actionGrid}>
                      {snapshot.operations.map(operation => (
                        <Button
                          key={operation.id}
                          appearance="secondary"
                          size="large"
                          className={styles.operationButton}
                          icon={operationIcon(operation.id)}
                          disabled={busy !== undefined}
                          onClick={() => run(operation.id)}
                        >
                          <span className={styles.operationButtonContent}>
                            <strong>{operation.title}</strong>
                            <Caption1>{operation.description}</Caption1>
                          </span>
                        </Button>
                      ))}
                    </div>
                  </Card>

                  {current === undefined ? (
                    <Card className={styles.card}>
                      <div className={styles.empty}>
                        <IconChecklist size={28} stroke={1.5} aria-hidden="true" />
                        <Title2>{copy.operationReady}</Title2>
                        <Text>{copy.operationReadyDescription}</Text>
                      </div>
                    </Card>
                  ) : (
                    <ResultView
                      styles={styles}
                      result={current}
                      operation={currentOperation}
                      busy={busy}
                      saveLabel={saveLabel}
                      onSaveLabelChange={setSaveLabel}
                      onRefresh={() => run(current.operationId)}
                      onReuse={() => { void apply(async () => { await workspace.reuse(current.operationId, current.id) }, 'run') }}
                      onSave={() => {
                        const label = saveLabel.trim() || currentOperation?.title || current.operationId
                        void apply(async () => { await workspace.saveCurrentResult(label) }, 'save')
                      }}
                    />
                  )}
                </div>

                <aside className={styles.sideColumn} aria-label={copy.savedActions}>
                  <SavedActions
                    styles={styles}
                    actions={snapshot.savedOperations}
                    busy={busy}
                    onRefresh={savedOperationId => {
                      void apply(async () => { await workspace.refreshSavedOperation(savedOperationId) }, 'run')
                    }}
                  />
                  <Card className={styles.card}>
                    <CardHeader title={copy.connection} description={activeConnection.identity.user.role} icon={<IconBuilding size={22} stroke={1.7} />} />
                    <Text weight="semibold">{tenantName(activeConnection)}</Text>
                    <Caption1>{activeConnection.identity.user.email}</Caption1>
                    <Link href={`${activeConnection.origin}/console/dashboard`} target="_blank" rel="noreferrer">
                      {copy.openConsole} <IconExternalLink size={14} stroke={1.8} aria-hidden="true" />
                    </Link>
                    <Divider />
                    <Caption1>{copy.disconnectDescription}</Caption1>
                    <Button
                      appearance="secondary"
                      icon={<IconLogout size={17} stroke={1.8} />}
                      disabled={busy !== undefined}
                      onClick={() => setDisconnectOpen(true)}
                    >
                      {copy.disconnect}
                    </Button>
                  </Card>
                </aside>
              </div>
            </>
          )}
        </main>
        <DisconnectDialog
          busy={busy}
          open={disconnectOpen}
          onClose={() => setDisconnectOpen(false)}
          onDisconnect={() => {
            void apply(async () => {
              await workspace.disconnect()
              setDisconnectOpen(false)
            }, 'disconnect')
          }}
        />
      </div>
    </FluentProvider>
  )
}

interface ConnectViewProps {
  readonly styles: ReturnType<typeof useStyles>
  readonly origin: string
  readonly pending: OryhWorkspaceSnapshot['pendingConnection']
  readonly busy: BusyAction
  readonly onOriginChange: (origin: string) => void
  readonly onBegin: () => void
  readonly onCancel: () => void
}

function ConnectView({ styles, origin, pending, busy, onOriginChange, onBegin, onCancel }: ConnectViewProps): ReactNode {
  return (
    <section className={styles.intro} aria-labelledby="connect-heading">
      <Caption1>{copy.connection}</Caption1>
      <Title1 id="connect-heading">{copy.connectEnterprise}</Title1>
      <Text>通过 ORYH 设备授权连接当前企业。浏览器登录与本地凭据存储彼此隔离。</Text>
      {pending === undefined ? (
        <Card className={styles.card}>
          <div className={styles.connectForm}>
            <Field label={copy.origin} hint={copy.originHelp}>
              <Input value={origin} onChange={event => onOriginChange(event.target.value)} />
            </Field>
            <Button appearance="primary" size="large" icon={<IconDeviceDesktop size={18} stroke={1.8} />} disabled={busy !== undefined} onClick={onBegin}>
              {copy.startConnection}
            </Button>
          </div>
        </Card>
      ) : (
        <DeviceAuthorization styles={styles} pending={pending} busy={busy} onCancel={onCancel} />
      )}
    </section>
  )
}

interface DeviceAuthorizationProps {
  readonly styles: ReturnType<typeof useStyles>
  readonly pending: NonNullable<OryhWorkspaceSnapshot['pendingConnection']>
  readonly busy: BusyAction
  readonly switchingAccount?: boolean
  readonly onCancel: () => void
}

/** Present only the safe device-flow prompt; credentials remain in the local Host. */
function DeviceAuthorization({ styles, pending, busy, switchingAccount = false, onCancel }: DeviceAuthorizationProps): ReactNode {
  return (
    <Card className={styles.card}>
      <div className={styles.approval}>
        <div className={styles.cardTitle}>
          <Title2>{copy.approvalTitle}</Title2>
          <Text>{copy.approvalDescription}</Text>
          {switchingAccount && <Caption1>{copy.switchAccountHelp}</Caption1>}
        </div>
        <div>
          <Caption1>{copy.userCode}</Caption1>
          <div className={styles.code}>{pending.prompt.userCode}</div>
        </div>
        <div className={styles.inlineStatus}><Spinner size="tiny" /><Text>{copy.waitingApproval}</Text></div>
        <div className={styles.resultToolbar}>
          <Button appearance="primary" as="a" href={pending.prompt.verificationUriComplete} target="_blank" rel="noreferrer">
            {copy.openApproval}
          </Button>
          <Button appearance="secondary" disabled={busy !== undefined} onClick={onCancel}>{copy.cancel}</Button>
        </div>
      </div>
    </Card>
  )
}

interface DisconnectDialogProps {
  readonly busy: BusyAction
  readonly open: boolean
  readonly onClose: () => void
  readonly onDisconnect: () => void
}

/** Confirm removal of one local credential bundle without ending the browser's ORYH session. */
function DisconnectDialog({ busy, open, onClose, onDisconnect }: DisconnectDialogProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(_event, data) => { if (!data.open) onClose() }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{copy.disconnectTitle}</DialogTitle>
          <DialogContent>{copy.disconnectDescription}</DialogContent>
          <DialogActions>
            <Button appearance="secondary" disabled={busy !== undefined} onClick={onClose}>{copy.cancel}</Button>
            <Button appearance="primary" disabled={busy !== undefined} onClick={onDisconnect}>{copy.disconnect}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

interface ResultViewProps {
  readonly styles: ReturnType<typeof useStyles>
  readonly result: OryhOperationResult
  readonly operation: OperationDefinition | undefined
  readonly busy: BusyAction
  readonly saveLabel: string
  readonly onSaveLabelChange: (label: string) => void
  readonly onRefresh: () => void
  readonly onReuse: () => void
  readonly onSave: () => void
}

function ResultView({
  styles,
  result,
  operation,
  busy,
  saveLabel,
  onSaveLabelChange,
  onRefresh,
  onReuse,
  onSave,
}: ResultViewProps): ReactNode {
  const total = result.result.meta.total ?? result.result.data.length
  return (
    <Card className={styles.card}>
      <CardHeader
        title={operation?.title ?? result.operationId}
        description={`${format(copy.total, { count: total })} · ${format(copy.refreshedAt, { time: displayTime(result.executedAt) })}`}
        icon={operationIcon(result.operationId)}
      />
      <div className={styles.resultToolbar}>
        <Button appearance="primary" icon={<IconRefresh size={17} stroke={1.8} />} disabled={busy !== undefined} onClick={onRefresh}>{copy.refresh}</Button>
        <Button appearance="secondary" icon={<IconCopy size={17} stroke={1.8} />} disabled={busy !== undefined} onClick={onReuse}>{copy.reuse}</Button>
      </div>
      <Caption1>{copy.resultReuseHint}</Caption1>
      <Divider />
      {result.operationId === 'list-projects'
        ? <ProjectResults styles={styles} projects={result.result.data as readonly OryhProject[]} />
        : result.operationId === 'my-expense-claims'
          ? <ExpenseClaimResults styles={styles} claims={result.result.data as readonly OryhExpenseClaim[]} />
          : <TodoResults styles={styles} todos={result.result.data as readonly OryhTodo[]} />}
      <Divider />
      <div className={styles.saveForm}>
        <Field label={copy.saveLabel} hint={copy.saveHelp}>
          <Input value={saveLabel} placeholder={operation?.title ?? copy.savePlaceholder} onChange={event => onSaveLabelChange(event.target.value)} />
        </Field>
        <Button appearance="secondary" icon={<IconDeviceFloppy size={17} stroke={1.8} />} disabled={busy !== undefined} onClick={onSave}>{copy.save}</Button>
      </div>
    </Card>
  )
}

function ProjectResults({ styles, projects }: { readonly styles: ReturnType<typeof useStyles>, readonly projects: readonly OryhProject[] }): ReactNode {
  if (projects.length === 0) return <Empty styles={styles} text={copy.projectEmpty} />
  return (
    <div className={styles.projectGrid}>
      {projects.map(project => (
        <article key={project.id} className={styles.project}>
          <div className={styles.todoTop}>
            <Text weight="semibold">{project.name}</Text>
            <Badge appearance="outline">{project.status}</Badge>
          </div>
          <div className={styles.projectMeta}>
            <span>{project.code ?? copy.noValue}</span>
            <span>{project.client ?? copy.noValue}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function TodoResults({ styles, todos }: { readonly styles: ReturnType<typeof useStyles>, readonly todos: readonly OryhTodo[] }): ReactNode {
  if (todos.length === 0) return <Empty styles={styles} text={copy.todoEmpty} />
  return (
    <div className={styles.todoGrid}>
      {todos.map(todo => (
        <article key={todo.id} className={styles.todo}>
          <div className={styles.todoTop}>
            <Text weight="semibold">{todo.title}</Text>
            <Badge appearance="outline">{todo.status}</Badge>
          </div>
          <div className={styles.projectMeta}>
            <span>{todo.target?.title ?? todo.entityType}</span>
            <span>{todo.dueAt === null ? copy.noValue : displayTime(todo.dueAt)}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function ExpenseClaimResults({ styles, claims }: { readonly styles: ReturnType<typeof useStyles>, readonly claims: readonly OryhExpenseClaim[] }): ReactNode {
  if (claims.length === 0) return <Empty styles={styles} text={copy.expenseClaimEmpty} />
  return (
    <div className={styles.todoGrid}>
      {claims.map(claim => (
        <article key={claim.id} className={styles.todo}>
          <div className={styles.todoTop}>
            <Text weight="semibold">{claim.title}</Text>
            <Badge appearance="outline">{claim.status}</Badge>
          </div>
          <div className={styles.projectMeta}>
            <span>{claim.currency}</span>
            <span>{claim.claimDate ?? copy.noValue}</span>
            <span>{claim.submittedAt === null ? copy.notSubmitted : format(copy.submittedAt, { time: displayTime(claim.submittedAt) })}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function SavedActions({
  styles,
  actions,
  busy,
  onRefresh,
}: {
  readonly styles: ReturnType<typeof useStyles>
  readonly actions: readonly SavedOperationView[]
  readonly busy: BusyAction
  readonly onRefresh: (savedOperationId: SavedOperationView['id']) => void
}): ReactNode {
  return (
    <Card className={styles.card}>
      <CardHeader title={copy.savedActions} description={copy.savedOperationHint} icon={<IconFolder size={22} stroke={1.7} />} />
      {actions.length === 0 ? <Empty styles={styles} text={copy.noSavedActions} /> : (
        <div className={styles.savedList}>
          {actions.map((action, index) => (
            <article key={action.id} className={`${styles.savedAction} ${index === actions.length - 1 ? styles.savedActionLast : ''}`}>
              <Text weight="semibold">{action.label}</Text>
              <Caption1>{action.operationId}</Caption1>
              <Button appearance="secondary" size="small" icon={<IconRefresh size={16} stroke={1.8} />} disabled={busy !== undefined} onClick={() => onRefresh(action.id)}>
                {copy.runSaved}
              </Button>
            </article>
          ))}
        </div>
      )}
    </Card>
  )
}

function Empty({ styles, text }: { readonly styles: ReturnType<typeof useStyles>, readonly text: string }): ReactNode {
  return <div className={styles.empty}><Text>{text}</Text></div>
}

function CardHeader({ title, description, icon }: { readonly title: string, readonly description: string, readonly icon: ReactNode }): ReactNode {
  const styles = useStyles()
  return (
    <div className={styles.cardHeader}>
      <div className={styles.cardTitle}>
        <Title2>{title}</Title2>
        <Caption1>{description}</Caption1>
      </div>
      <span aria-hidden="true">{icon}</span>
    </div>
  )
}

function operationIcon(operationId: OperationId): ReactElement {
  switch (operationId) {
    case 'my-open-todos':
      return <IconChecklist size={18} stroke={1.8} />
    case 'my-expense-claims':
      return <IconReceipt size={18} stroke={1.8} />
    case 'list-projects':
      return <IconFolder size={18} stroke={1.8} />
  }
}

function operationById(operations: readonly OperationDefinition[], operationId: OperationId): OperationDefinition | undefined {
  return operations.find(operation => operation.id === operationId)
}

function tenantName(connection: ConnectionSummary): string {
  return connection.identity.tenant.name ?? connection.identity.tenant.slug
}

function displayTime(value: string): string {
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return copy.noValue
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(time)
}

function messageFor(reason: unknown): string {
  if (reason instanceof LocalRemoteError && reason.code === 'employee-required') return copy.employeeRequired
  if (reason instanceof LocalRemoteError && reason.code === 'connection-identity-mismatch') return copy.connectionIdentityMismatch
  if (reason instanceof Error && reason.message.length > 0) return reason.message
  return copy.genericError
}

function useSystemTheme(): [boolean, (update: (value: boolean) => boolean) => void] {
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent) => setIsDark(event.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return [isDark, setIsDark]
}
