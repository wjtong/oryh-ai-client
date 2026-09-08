import type { BusinessView } from './layout-store.js';
import { useBusinessText } from './locale.js';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent } from 'react';
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
}
export function Workbench({ page, connection, operations, onDirtyChange, settings, notices }: {
    page: BusinessView;
    connection: ConnectionSummary;
    operations: readonly OperationDefinition[];
    onDirtyChange: (dirty: boolean) => void;
    settings: ReactNode;
    notices: ReactNode;
}): ReactNode {
    const t = useBusinessText();
    const pages: Record<OperationId, {
        title: string;
        description: string;
        icon: typeof IconChecklist;
    }> = {
        'my-open-todos': { title: t("text8"), description: t("text9"), icon: IconChecklist },
        'my-expense-claims': { title: t("text10"), description: t("text11"), icon: IconReceipt },
        'list-projects': { title: t("text12"), description: t("text13"), icon: IconFolder },
    };
    const [visited, setVisited] = useState<OperationId[]>(['my-open-todos']);
    const [expenseTab, setExpenseTab] = useState<'list' | 'drafts'>('list');
    const [expenseVisited, setExpenseVisited] = useState(false);
    const [newExpenseRequest, setNewExpenseRequest] = useState(0);
    const company = connection.identity.tenant.name ?? connection.identity.tenant.slug;
    useEffect(() => { if (page !== 'settings') setVisited(current => current.includes(page) ? current : [...current, page]); }, [page]);
    function report(_id: string, _value: PageContext) { }
    return <div className="oryh-business">
    <header className="oryh-business-header"><strong>{company}</strong><span>{connection.identity.user.email}</span></header>
    <main className="business-content">
      {notices}
      <div className="breadcrumb">{t("text16")}<IconChevronRight size={13}/> {page === 'settings' ? t("text17") : pages[page].title}</div>
      <div className="page-heading"><div><h1>{page === 'settings' ? t("text17") : pages[page].title}</h1><p>{page === 'settings' ? t("text18") : pages[page].description}</p></div></div>
      {visited.map(id => <section key={id} hidden={page !== id} aria-label={t("text19", { value0: pages[id].title })}>
        {id === 'my-expense-claims' && <div className="view-tabs" role="group" aria-label={t("text20")}>
          <Button appearance={expenseTab === 'list' ? 'secondary' : 'subtle'} aria-pressed={expenseTab === 'list'} onClick={() => setExpenseTab('list')}>{t("text21")}</Button>
          <Button appearance={expenseTab === 'drafts' ? 'secondary' : 'subtle'} aria-pressed={expenseTab === 'drafts'} onClick={() => { setExpenseTab('drafts'); setExpenseVisited(true); }}>{t("text22")}</Button>
        </div>}
        <div hidden={id === 'my-expense-claims' && expenseTab !== 'list'}><BusinessPage connection={connection} operationId={id} active={page === id && (id !== 'my-expense-claims' || expenseTab === 'list')} onContext={value => report(id, value)} onNewExpense={id === 'my-expense-claims' ? () => { setExpenseTab('drafts'); setExpenseVisited(true); setNewExpenseRequest(value => value + 1); } : undefined}/></div>
        {id === 'my-expense-claims' && expenseVisited && <div hidden={expenseTab !== 'drafts'}><ExpensePanel connection={connection} newRequest={newExpenseRequest} onDirtyChange={onDirtyChange} onContext={value => report('expense-draft', value)}/></div>}
      </section>)}
      {page === 'settings' && <section className="settings-page"><div className="surface"><h2>{t("text15")}</h2><dl className="detail-grid"><dt>{t("text23")}</dt><dd>{company}</dd><dt>{t("text24")}</dt><dd>{connection.identity.user.email}</dd><dt>{t("text25")}</dt><dd>{connection.origin}</dd></dl>{settings}</div></section>}
    </main>
  </div>;
}
