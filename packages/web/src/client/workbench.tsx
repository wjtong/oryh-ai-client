import {recordDefaultColumns} from '@oryh/ai-client-core/views';
import {RecordPanel,isRecordKind,recordTitles} from './records.js';
import {ProjectPanel} from './projects.js';
import type { ChatNavigation as Navigation } from '@oryh/dsh-host/types';
import { ChatNavigation, BusinessNavigationContext } from './chat-navigation.js';
import { TimesheetPanel } from './timesheets.js';
import type { BusinessView } from './layout-store.js';
import { useText } from './locale.js';
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent } from 'react';
import { Badge, Button, Textarea } from '@fluentui/react-components';
import { IconBuilding, IconChecklist, IconReceipt, IconFolder, IconSettings, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMessage, IconX, IconArrowUp, IconArrowUpRight, IconChevronRight } from '@tabler/icons-react';
import type { ConnectionSummary, OperationDefinition, OperationId } from '@oryh/ai-client-core';
import { BusinessPage } from './business-page.js';
import { ExpensePanel } from './expenses.js';
export interface PageContext {
    title: string;
    detail: string;
    scope: string;
    key: string;
    content?: string;
    columns?: string[];
    queryFields?:string[];
    productCode?:string;
    productIds?:string[];
    availableColumns?:{id:string;label:string}[];
}
export function Workbench({ page, connection, operations, onDirtyChange, settings, notices }: {
    page: BusinessView;
    connection: ConnectionSummary;
    operations: readonly OperationDefinition[];
    onDirtyChange: (dirty: boolean) => void;
    settings: ReactNode;
    notices: ReactNode;
}): ReactNode {
    const t = useText();
    const navigate=useContext(BusinessNavigationContext);
    const [navigation,setNavigation]=useState<Navigation>();
    const pages: Record<OperationId, {
        title: string;
        description: string;
        icon: typeof IconChecklist;
    }> = {
        'my-open-todos': { title: t("text8"), description: t("text9"), icon: IconChecklist },
        'my-expense-claims': { title: t("text10"), description: t("text11"), icon: IconReceipt },
        'list-projects': { title: t("text12"), description: t("text13"), icon: IconFolder },
    };
    const [recordViewColumns,setRecordViewColumns]=useState(recordDefaultColumns);
    const [projectColumns,setProjectColumns]=useState<import('@oryh/dsh-host/types').ProjectColumn[]>(['name','status','client','startDate']);
    const [projectDirty,setProjectDirty]=useState(false);
    const [expenseDirty, setExpenseDirty] = useState(false);
    const [timesheetDirty, setTimesheetDirty] = useState(false);
    const [approvalDirty, setApprovalDirty] = useState(false);
    const [timesheetVisited, setTimesheetVisited] = useState(false);
    const [approvalVisited, setApprovalVisited] = useState(false);
    useEffect(() => onDirtyChange(expenseDirty || timesheetDirty || approvalDirty || projectDirty), [expenseDirty, timesheetDirty, approvalDirty, projectDirty, onDirtyChange]);
    const [visited, setVisited] = useState<OperationId[]>(['my-open-todos']);
    const [expenseTab, setExpenseTab] = useState<'list' | 'drafts'>('list');
    const [expenseVisited, setExpenseVisited] = useState(false);
    const [newExpenseRequest, setNewExpenseRequest] = useState(0);
    const company = connection.identity.tenant.name ?? connection.identity.tenant.slug;
    useEffect(() => { if (page === 'timesheets') setTimesheetVisited(true); else if (page === 'timesheet-approvals') setApprovalVisited(true); else if (page !== 'settings'&&!isRecordKind(page)) setVisited(current => current.includes(page) ? current : [...current, page]); }, [page]);
    const main = useRef<HTMLElement>(null);
    useEffect(() => { const seat = main.current?.closest<HTMLElement>('.oryh-business-seat'); if (seat) seat.scrollTop = 0; }, [page, expenseTab]);
    const [pageContexts,setPageContexts]=useState<Record<string,PageContext>>({});
    function report(id: string, value: PageContext) { setPageContexts(current=>JSON.stringify(current[id])===JSON.stringify(value)?current:{...current,[id]:value}); }
    const chatContext=page==='my-expense-claims'&&expenseTab==='drafts'?pageContexts['expense-draft']:pageContexts[page];
    return <div className="oryh-business">
    <ChatNavigation page={page} {...(chatContext?{context:chatContext}:{})} connectionId={connection.id} onOpen={command=>{if(command.target==='filters'){setNavigation(command);return}if(command.target==='columns'&&command.columns){if(command.page&&isRecordKind(command.page)){const kind=command.page,columns=command.columns;setRecordViewColumns(v=>({...v,[kind]:columns}))}else setProjectColumns(command.columns as import('@oryh/dsh-host/types').ProjectColumn[]);return}if(command.target==='page'&&command.page){setNavigation(undefined);navigate(command.page);return}setNavigation(command);if(command.target==='project'){setVisited(current=>current.includes('list-projects')?current:[...current,'list-projects']);navigate('list-projects')}else if(command.manager){setApprovalVisited(true);navigate('timesheet-approvals')}else{setTimesheetVisited(true);navigate('timesheets')}}}/>
    <main ref={main} className="business-content">
      {notices}
      <div className="breadcrumb">{t("text16")}<IconChevronRight size={13}/> {page === 'settings' ? t('text17') : page === 'timesheets' ? t('tsMine') : page === 'timesheet-approvals' ? t('tsApprovals') : isRecordKind(page)?recordTitles[page]:pages[page].title}</div>
      {page === 'settings' && <div className="page-heading"><div><h1>{t('text17')}</h1><p>{t('text18')}</p></div></div>}
      {isRecordKind(page)&&<RecordPanel key={`${connection.id}:${page}`} kind={page} {...(navigation?.target==='filters'?{filterCommand:navigation}:{})} columns={recordViewColumns[page]} onColumns={columns=>setRecordViewColumns(v=>({...v,[page]:columns}))} connectionId={connection.id} onContext={value=>report(page,value)}/>}
      {visited.map(id => <section key={id} hidden={page !== id} aria-label={t("text19", { value0: pages[id].title })}>
        {id === 'my-expense-claims' && <div className="view-tabs" role="group" aria-label={t("text20")}>
          <Button appearance={expenseTab === 'list' ? 'secondary' : 'subtle'} aria-pressed={expenseTab === 'list'} onClick={() => setExpenseTab('list')}>{t("text21")}</Button>
          <Button appearance={expenseTab === 'drafts' ? 'secondary' : 'subtle'} aria-pressed={expenseTab === 'drafts'} onClick={() => { setExpenseTab('drafts'); setExpenseVisited(true); }}>{t("text22")}</Button>
        </div>}
        {id==='list-projects'&&<ProjectPanel columns={projectColumns} onColumns={setProjectColumns} connection={connection} active={page===id} {...(navigation?.target==='project'?{navigation}: {})} onDirtyChange={setProjectDirty} onContext={value=>report(id,value)}/>}
        {id!=='list-projects'&&<div hidden={id === 'my-expense-claims' && expenseTab !== 'list'}><BusinessPage connection={connection} operationId={id} active={page === id && (id !== 'my-expense-claims' || expenseTab === 'list')} onContext={value => report(id, value)} onNewExpense={id === 'my-expense-claims' ? () => { setExpenseTab('drafts'); setExpenseVisited(true); setNewExpenseRequest(value => value + 1); } : undefined}/></div>}
        {id === 'my-expense-claims' && expenseVisited && <div hidden={expenseTab !== 'drafts'}><ExpensePanel connection={connection} newRequest={newExpenseRequest} onDirtyChange={setExpenseDirty} onContext={value => report('expense-draft', value)}/></div>}
      </section>)}
      {timesheetVisited && <div hidden={page !== 'timesheets'}><TimesheetPanel connection={connection} active={page === 'timesheets'} {...(!navigation?.manager&&navigation&&navigation.target!=='project'?{navigationId:navigation.id,navigation}:{})} manager={false} onDirtyChange={setTimesheetDirty}/></div>}
      {approvalVisited && <div hidden={page !== 'timesheet-approvals'}><TimesheetPanel connection={connection} active={page === 'timesheet-approvals'} {...(navigation?.manager?{navigationId:navigation.id,navigation}:{})} manager onDirtyChange={setApprovalDirty}/></div>}
      {page === 'settings' && <section className="settings-page"><div className="surface"><h2>{t("text15")}</h2><dl className="detail-grid"><dt>{t("text23")}</dt><dd>{company}</dd><dt>{t("text24")}</dt><dd>{connection.identity.user.email}</dd><dt>{t("text25")}</dt><dd>{connection.origin}</dd></dl>{settings}</div></section>}
    </main>
  </div>;
}
