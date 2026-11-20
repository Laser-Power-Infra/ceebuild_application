'use client';

import React, { useState, useEffect, useRef } from 'react';
import { autoDetectOurItemNot } from '@/lib/classifier';
import { AppSidebar, PageHeader } from '@/components/AppSidebar';
import {
  Search,
  Filter,
  Calendar,
  Database,
  RefreshCw,
  Plus,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Building,
  FileText,
  History,
  X,
  Clock,
  Tag,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Package,
  Layers,
  UserCheck,
  Clipboard,
  Trash2,
  Lock,
  Unlock,
  LogOut,
  KeyRound,
  ShieldCheck,
  Sliders,
  Check,
  ToggleLeft,
  ToggleRight,
  PlusCircle,
  Sparkles,
  Wand2,
  Brain,
  HelpCircle,
  Upload,
  FileUp,
  Table,
  LayoutGrid,
  Paperclip,
  File,
  Download,
  Eye,
} from 'lucide-react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import MultiSelectFilterDropdown from '@/components/MultiSelectFilterDropdown';
import ConfirmDialog, { type ConfirmDialogOptions } from '@/components/ConfirmDialog';
import ConditionSelect from '@/components/ConditionSelect';
import { DOCKET_TYPES, isDocketType } from '@/lib/dockets';
import { DocketsTab } from '@/modules/dockets/ui/DocketsTab';
import {
  DOCKET_FILTER_KEYS,
  emptyDocketFilters,
  type Docket,
  type DocketActions,
  type DocketFilters,
  type DocketItem,
  type DocketSort,
  type ItemUpdate,
} from '@/modules/dockets/types';

// Row shapes live with the Dockets screen (src/modules/dockets/types.ts).
type Item = DocketItem;
type DockerParty = Docket;

interface TermCondition {
  id: number;
  price: string | null;
  payment: string | null;
  delivery: string | null;
  warranty: string | null;
  approval: string | null;
  inspection: string | null;
}

interface EditLog {
  id: number;
  tableName: string;
  recordId: number;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  userId?: number | null;
  userName?: string | null;
  createdAt: string;
}

interface MasterValueItem {
  id: number;
  type: string;
  value: string;
  isActive: boolean;
  createdAt: string;
}

// Signed-in user as returned by NextAuth's GET /api/auth/session (guests get a read-only default).
interface UserRole {
  username: string;
  name: string;
  id: string; // display id, e.g. "USR-3"
  role: 'Admin' | 'User' | 'Viewer';
}

// Friendly labels for the audit log's internal table names.
const TABLE_LABELS: Record<string, string> = {
  'iteam-table': 'Items',
  'docket-party-name': 'Dockets',
  'tream-and-conditions': 'Terms & Conditions',
  'master-values': 'Master Dropdowns',
  orders: 'Orders',
  bom_uploads: 'BOM uploads',
  bom_pieces: 'BOM rows',
  section_master: 'GTP sections',
  galv_challans: 'Galvanising challans',
  inspections: 'Inspections / MC',
  dispatch_instructions: 'Dispatch instructions',
  dispatches: 'Dispatches',
  users: 'User Accounts',
};

// Lightweight auto-resizing text component that avoids browser thread locking
// onSave may return a promise; resolving to false means the save failed and the cell reverts.
type CellSaveHandler = (val: string) => unknown;

function AutoResizeTextarea({
  defaultValue,
  onSave,
  onPaste,
  className = '',
  placeholder = '',
  readOnly = false,
}: {
  defaultValue: string;
  onSave: CellSaveHandler;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const [val, setVal] = useState(defaultValue || '');

  useEffect(() => {
    setVal(defaultValue || '');
  }, [defaultValue]);

  // Only save when the text differs from the current stored value, so leaving a cell never
  // writes an old value over one that was pasted / applied by AI in the meantime.
  const handleBlur = async () => {
    const original = defaultValue || '';
    if (readOnly || val === original) return;
    const ok = await onSave(val);
    if (ok === false) setVal(original);
  };

  return (
    <textarea
      value={val}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => setVal(e.target.value)}
      onBlur={handleBlur}
      onPaste={readOnly ? undefined : onPaste}
      rows={val && val.length > 35 ? 2 : 1}
      className={`w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 text-xs font-medium text-slate-900 focus:outline-none resize-y leading-snug transition-all ${className}`}
    />
  );
}

// Controlled single-line (or plain multi-line) cell: follows the stored value, saves on blur only when changed.
function CellInput({
  value,
  onSave,
  onPaste,
  className = '',
  readOnly = false,
  multiline = false,
  rows,
}: {
  value: string;
  onSave: CellSaveHandler;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  className?: string;
  readOnly?: boolean;
  multiline?: boolean;
  rows?: number;
}) {
  const [val, setVal] = useState(value || '');

  useEffect(() => {
    setVal(value || '');
  }, [value]);

  const handleBlur = async () => {
    const original = value || '';
    if (readOnly || val === original) return;
    const ok = await onSave(val);
    if (ok === false) setVal(original);
  };

  if (multiline) {
    return (
      <textarea
        value={val}
        readOnly={readOnly}
        rows={rows}
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleBlur}
        onPaste={readOnly ? undefined : onPaste}
        className={className}
      />
    );
  }
  return (
    <input
      type="text"
      value={val}
      readOnly={readOnly}
      onChange={(e) => setVal(e.target.value)}
      onBlur={handleBlur}
      onPaste={readOnly ? undefined : onPaste}
      className={className}
    />
  );
}

const TAB_META: Record<'dockets' | 'terms' | 'logs' | 'master', { title: string; description: string }> = {
  dockets: { title: 'Dockets', description: 'Quotation dockets, parties and enquiry details' },
  terms: { title: 'Terms & Conditions', description: 'Standard terms printed on quotations' },
  logs: { title: 'Audit Log', description: 'Every change made to dockets, items and terms' },
  master: { title: 'Master Dropdowns', description: 'Values offered in party, state, utility and address fields' },
};

const STORE_DOCKET_PAGE_SIZE = 'ceebuild.dockets.pageSize';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'dockets' | 'terms' | 'logs' | 'master'>('dockets');

  // Authentication & User State
  // Viewing is public: visitors without a NextAuth session browse as a read-only Guest.
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<UserRole>({
    username: '',
    name: 'Guest',
    id: '',
    role: 'Viewer',
  });
  const isLoggedIn = currentUser.username !== '';
  const canEdit = currentUser.role === 'Admin' || currentUser.role === 'User';

  // Confirmation dialog for destructive actions
  const [confirmState, setConfirmState] = useState<ConfirmDialogOptions | null>(null);
  // In-app attachment preview (eye icon) — keeps the file inside the dashboard instead of a new tab
  const [previewAttachment, setPreviewAttachment] = useState<{ key: string; name: string } | null>(null);
  // Docket whose attachment list popup is open (eye button beside "+ Attach Files")
  const [attachmentListDocId, setAttachmentListDocId] = useState<number | null>(null);

  // Master Values state for Admin Management
  const [masterList, setMasterList] = useState<MasterValueItem[]>([]);
  const [masterListLoading, setMasterListLoading] = useState(false);
  const [masterCategoryFilter, setMasterCategoryFilter] = useState<string>('PARTY_NAME');
  const [newMasterForm, setNewMasterForm] = useState({
    type: 'PARTY_NAME',
    value: '',
  });

  // Master Values Suggestions state for Form Auto-Completion
  const [masterSuggestions, setMasterSuggestions] = useState<{
    PARTY_NAME: string[];
    STATE: string[];
    UTILITY: string[];
    ADDRESS: string[];
    STATUS: string[];
  }>({
    PARTY_NAME: [],
    STATE: [],
    UTILITY: [],
    ADDRESS: [],
    STATUS: ['Quoted', 'NOT Required'],
  });

  // Global Filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination states
  const [docketPage, setDocketPage] = useState(1);
  const [docketLimit, setDocketLimit] = useState(50);
  const [docketTotalCount, setDocketTotalCount] = useState(0);
  const [docketTotalPages, setDocketTotalPages] = useState(1);

  const ourItemNameOptions = [
    'Fabricated Structures',
    'GI Wires',
    'Anti-Climbing Device',
    'Stay Set - 33KV',
    'Stay Set - 11KV',
    'Name Plate',
    'Phase Plate',
    'Circuit Plate',
    'Danger Plate',
    'Pipe Earthing',
    'Rod Earthing',
    'Coil Earthing',
    'Conterpoise Earthing',
    'Bird Guard',
    'OTHERS',
    'GI Pipe',
  ];

  // Dockets
  const [dockets, setDockets] = useState<DockerParty[]>([]);
  const docketsRef = useRef<DockerParty[]>(dockets);
  docketsRef.current = dockets;
  const [docketsLoading, setDocketsLoading] = useState(false);
  const [docketFilters, setDocketFilters] = useState<DocketFilters>(emptyDocketFilters);
  const [docketSort, setDocketSort] = useState<DocketSort | null>(null);
  const [docketTotalItems, setDocketTotalItems] = useState(0);
  const [docketsError, setDocketsError] = useState<string | null>(null);
  const [stateOptions, setStateOptions] = useState<string[]>([]);
  const [docketOptions, setDocketOptions] = useState<string[]>([]);
  const [partyOptions, setPartyOptions] = useState<string[]>([]);
  const [utilityOptions, setUtilityOptions] = useState<string[]>([]);
  // Items of the dockets on screen, by docket number
  const [docketItemsMap, setDocketItemsMap] = useState<{ [docketNo: string]: Item[] }>({});

  // Modals state
  const [showAddDocketModal, setShowAddDocketModal] = useState(false);
  const [nextDocketNo, setNextDocketNo] = useState('CEE-000518');
  const [newDocketForm, setNewDocketForm] = useState({
    docketNoQtnNo: 'CEE-000518',
    partyName: '',
    address: '',
    state: '',
    utility: '',
    deliveryLocation: '',
    type: '',
    price: '',
    payment: '',
    delivery: '',
    warranty: '',
    approval: '',
    inspection: '',
  });

  // Dynamic Item Row Boxes in Add Docket Modal (Supports Excel Drag-&-Drop, Copy-Paste & Smart Column Tracking)
  const [docketItemsForm, setDocketItemsForm] = useState<
    Array<{
      itemNameParty: string;
      uom: string;
      qty: string;
      ourItemNot?: string;
      ourItemName?: string;
      size?: string;
      weightPerPiece?: string;
      unitWtOfMemberKg?: string;
      price?: string;
      sectionMm?: string;
      sectionalWtKgMtr?: string;
      lengthInMtr?: string;
      status?: string;
    }>
  >([
    {
      itemNameParty: '',
      uom: '',
      qty: '',
      ourItemNot: '',
      ourItemName: '',
      size: '',
      weightPerPiece: '',
      unitWtOfMemberKg: '',
      price: '',
    },
  ]);

  const [docketItemViewMode, setDocketItemViewMode] = useState<'boxes' | 'table'>('boxes');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemForm, setNewItemForm] = useState({
    docketNoQtnNo: '',
    itemNameParty: '',
    uom: '',
    qty: '',
    ourItemNot: '',
    typeOfItem: '',
    ourItemName: '',
    size: '',
    weightPerPiece: '',
    price: '',
    uomOfQtn: '',
    status: '',
  });

  // Terms
  const [terms, setTerms] = useState<TermCondition[]>([]);
  const [termsDropdowns, setTermsDropdowns] = useState<{
    price: string[];
    payment: string[];
    delivery: string[];
    warranty: string[];
    approval: string[];
    inspection: string[];
  }>({
    price: [],
    payment: [],
    delivery: [],
    warranty: [],
    approval: [],
    inspection: [],
  });
  const [termsLoading, setTermsLoading] = useState(false);
  const [newTerm, setNewTerm] = useState({
    price: '',
    payment: '',
    delivery: '',
    warranty: '',
    approval: '',
    inspection: '',
  });
  const [showAddTerm, setShowAddTerm] = useState(false);

  // Edit Logs
  const [logs, setLogs] = useState<EditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logTableFilter, setLogTableFilter] = useState('');

  // Toast
  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  // AI Autofill state
  const [aiProcessing, setAiProcessing] = useState<boolean>(false);
  const [aiProgressText, setAiProgressText] = useState<string>('');

  // AI Reasoning Explanation Modal state
  const [reasoningModalOpen, setReasoningModalOpen] = useState<boolean>(false);
  const [reasoningItemText, setReasoningItemText] = useState<string>('');
  const [reasoningCategory, setReasoningCategory] = useState<string>('');
  const [reasoningType, setReasoningType] = useState<string>('');
  const [reasoningContent, setReasoningContent] = useState<string>('');
  const [reasoningUserNote, setReasoningUserNote] = useState<string>('');
  const [reasoningLoading, setReasoningLoading] = useState<boolean>(false);
  const [savingKnowledge, setSavingKnowledge] = useState<boolean>(false);

  // Structural Calculator Queue & Modal State
  const [structuralQueue, setStructuralQueue] = useState<Item[]>([]);
  const [currentStructuralIndex, setCurrentStructuralIndex] = useState<number>(0);
  const [structuralLoading, setStructuralLoading] = useState<boolean>(false);
  const [structuralOptions, setStructuralOptions] = useState<any[]>([]);
  const [selectedStructuralOption, setSelectedStructuralOption] = useState<any>(null);
  const [showStructuralModal, setShowStructuralModal] = useState<boolean>(false);
  const [customStructuralForm, setCustomStructuralForm] = useState({
    sectionMm: '',
    sectionalWtKgMtr: '',
    lengthInMtr: '',
    unitWtOfMemberKg: '',
  });

  const [structuralErrorMessage, setStructuralErrorMessage] = useState<string>('');

  // Guards against slow responses overwriting newer ones (search/filter changes, skipped AI items).
  const structuralRequestRef = useRef(0);
  const reasoningRequestRef = useRef(0);
  const docketsAbortRef = useRef<AbortController | null>(null);
  const logsAbortRef = useRef<AbortController | null>(null);
  const docketItemsAbortRef = useRef<{ [docketNo: string]: AbortController }>({});

  // The Groq key is server-side only now (AI routes ignore client keys); drop any key a browser saved earlier.
  useEffect(() => {
    try {
      localStorage.removeItem('groq_api_key');
    } catch {}
  }, []);

  const fetchStructuralOptionsForItem = async (item: Item) => {
    // Each call supersedes the previous one; a late answer for a skipped item is dropped.
    const requestId = ++structuralRequestRef.current;
    const isCurrent = () => requestId === structuralRequestRef.current;
    setStructuralLoading(true);
    setStructuralOptions([]);
    setSelectedStructuralOption(null);
    setStructuralErrorMessage('');
    setCustomStructuralForm({
      sectionMm: '',
      sectionalWtKgMtr: '',
      lengthInMtr: '',
      unitWtOfMemberKg: '',
    });

    try {
      const res = await fetch('/api/ai/structural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          itemNameParty: item.itemNameParty,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (!res.ok || data.error) {
        setStructuralErrorMessage(data.error || 'Failed to fetch AI structural calculations');
      } else if (data.options && Array.isArray(data.options)) {
        setStructuralOptions(data.options);
        if (data.options.length > 0) {
          const firstOpt = data.options[0];
          setSelectedStructuralOption(firstOpt);
          setCustomStructuralForm({
            sectionMm: firstOpt.sectionCode || '',
            sectionalWtKgMtr: firstOpt.sectionalWtKgMtr || '',
            lengthInMtr: firstOpt.lengthMtr || '',
            unitWtOfMemberKg: firstOpt.unitWtKg || '',
          });
        } else {
          setStructuralErrorMessage('Groq AI returned no structural section options for this description.');
        }
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      console.error('Error fetching structural options for item:', err);
      setStructuralErrorMessage(err.message || 'Failed to connect to Groq AI API');
    } finally {
      if (isCurrent()) setStructuralLoading(false);
    }
  };

  const handleApplyStructuralOption = async () => {
    const currentItem = structuralQueue[currentStructuralIndex];
    if (!currentItem) return;

    try {
      setStructuralLoading(true);
      const structuralFields: Array<keyof typeof customStructuralForm> = [
        'sectionMm',
        'sectionalWtKgMtr',
        'lengthInMtr',
        'unitWtOfMemberKg',
      ];
      for (const f of structuralFields) {
        const ok = await handleItemFieldUpdate(currentItem.id, f, customStructuralForm[f], currentItem.docketNoQtnNo);
        if (!ok) return; // error toast already shown; stay on this item
      }

      showToast(`Saved Structural Section for Item #${currentItem.id}!`);

      const nextIndex = currentStructuralIndex + 1;
      if (nextIndex < structuralQueue.length) {
        setCurrentStructuralIndex(nextIndex);
        await fetchStructuralOptionsForItem(structuralQueue[nextIndex]);
      } else {
        setShowStructuralModal(false);
        showToast('🎉 Completed Structural AI calculations for all BOM items!');
      }
    } catch (err) {
      console.error('Error saving structural selection:', err);
    } finally {
      setStructuralLoading(false);
    }
  };

  const handleSkipStructuralOption = async () => {
    const nextIndex = currentStructuralIndex + 1;
    if (nextIndex < structuralQueue.length) {
      setCurrentStructuralIndex(nextIndex);
      await fetchStructuralOptionsForItem(structuralQueue[nextIndex]);
    } else {
      setShowStructuralModal(false);
    }
  };

  const openReasoningModal = async (itemNameParty: string | null, typeOfItem: string | null, selectedCategory: string | null) => {
    if (!itemNameParty || !selectedCategory) return;
    setReasoningItemText(itemNameParty);
    setReasoningCategory(selectedCategory);
    setReasoningType(typeOfItem || 'N/A');
    setReasoningContent('');
    setReasoningUserNote('');
    setReasoningLoading(true);
    setReasoningModalOpen(true);
    // A late explanation for a previously opened item must not replace this one.
    const requestId = ++reasoningRequestRef.current;
    const isCurrent = () => requestId === reasoningRequestRef.current;

    try {
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNameParty,
          typeOfItem: typeOfItem || '',
          selectedCategory,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (res.ok && data.reasoning) {
        setReasoningContent(data.reasoning);
        setReasoningUserNote(data.reasoning);
      } else {
        setReasoningContent(data.error || 'Categorized strictly based on raw item text specifications.');
        setReasoningUserNote(data.error || 'Categorized strictly based on raw item text specifications.');
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      console.error(err);
      setReasoningContent('Factual categorization based on raw item text specifications.');
      setReasoningUserNote('Factual categorization based on raw item text specifications.');
    } finally {
      if (isCurrent()) setReasoningLoading(false);
    }
  };

  // Save manual correction to PostgreSQL AI Knowledge Base
  const handleSaveAiKnowledge = async () => {
    setSavingKnowledge(true);
    try {
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saveToKnowledge: true,
          itemNameParty: reasoningItemText,
          typeOfItem: reasoningType,
          selectedCategory: reasoningCategory,
          userReason: reasoningUserNote || reasoningContent,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast('🎓 Saved to AI Knowledge Base! AI will use this rule for future categorizations.');
        setReasoningModalOpen(false);
      } else {
        showToast(`Error: ${data.error || 'Failed to save rule'}`);
      }
    } catch (err: any) {
      console.error(err);
      showToast('Error: Failed to save knowledge rule');
    } finally {
      setSavingKnowledge(false);
    }
  };

  // Handle Groq AI Categorization ("Autofill by AI")
  const handleAiAutofill = async (targetDocketNo?: string) => {
    targetDocketNo = (targetDocketNo || '').trim() || undefined;
    if (!targetDocketNo) {
      showToast('Autofill by AI needs a docket number. Set the Docket / Qtn No (or filter Items to one docket) first.');
      return;
    }
    setAiProcessing(true);
    setAiProgressText(
      targetDocketNo
        ? `AI Analyzing Manufacturing/Trading items for Docket ${targetDocketNo}...`
        : 'AI Analyzing & Categorizing Manufacturing/Trading items...'
    );

    try {
      const res = await fetch('/api/ai/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docketNoQtnNo: targetDocketNo,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'AI categorization failed');
      }

      let freshDocketItems: Item[] | null = null;
      if (data.updatedCount === 0) {
        showToast('AI Check Complete: No unclassified Manufacturing/Trading items found.');
      } else {
        showToast(`✨ AI Autofill Complete! Categorized ${data.updatedCount} items.`);
        // Refresh items table & docket map
        await fetchDockets();
        if (targetDocketNo) {
          freshDocketItems = await fetchItemsForDocket(targetDocketNo, true);
        } else {
          // Force refresh all currently cached expanded dockets so item count is never 0
          Object.keys(docketItemsMap).forEach((dNo) => {
            fetchItemsForDocket(dNo, true);
          });
        }
      }

      fetchDockets(); // docket rows carry their first item and item count

      // Collect candidate items for Structural Calculator (MANUFACTURING/TRADING items with blank sectionMm)
      let candidates: Item[] = [];
      // docketItemsMap in this closure predates the AI update, so prefer the freshly fetched list.
      const targetDocketItems = targetDocketNo ? freshDocketItems ?? docketItemsMap[targetDocketNo] : undefined;
      if (targetDocketNo && targetDocketItems) {
        candidates = targetDocketItems.filter(
          (it) =>
            (it.ourItemNot === 'MANUFACTURING' || it.ourItemNot === 'TRADING') &&
            (!it.sectionMm || it.sectionMm.trim() === '')
        );
      } else {
        candidates = Object.values(docketItemsMap).flat().filter(
          (it) =>
            (it.ourItemNot === 'MANUFACTURING' || it.ourItemNot === 'TRADING') &&
            (!it.sectionMm || it.sectionMm.trim() === '')
        );
      }

      if (candidates.length > 0) {
        setStructuralQueue(candidates);
        setCurrentStructuralIndex(0);
        setShowStructuralModal(true);
        fetchStructuralOptionsForItem(candidates[0]);
      }
    } catch (err: any) {
      console.error('AI Error:', err);
      showToast(`AI Error: ${err.message || 'Failed to complete AI categorization'}`);
    } finally {
      setAiProcessing(false);
      setAiProgressText('');
    }
  };

  // Logout handler: ends the NextAuth session, then reloads the dashboard as a read-only Guest
  const handleLogout = async () => {
    try {
      // LEGACY (custom cookie auth, replaced by NextAuth on 2026-11-17):
      // await fetch('/api/auth/logout', { method: 'POST' });
      await signOut({ redirect: false });
    } catch (err) {
      console.error(err);
    }
    // LEGACY: window.location.href = '/login';
    window.location.reload();
  };

  // Fetch Master Values for auto-complete dropdowns
  const fetchMasterValues = async () => {
    setMasterListLoading(true);
    try {
      const res = await fetch('/api/master-values');
      const data = await res.json();
      if (data.masterValues) {
        setMasterList(data.masterValues);
      }
      if (data.grouped) {
        setMasterSuggestions((prev) => ({
          ...prev,
          ...data.grouped,
        }));
      }
    } catch (err) {
      console.error('Error fetching master values:', err);
    } finally {
      setMasterListLoading(false);
    }
  };

  // Create new Master Value (Admin)
  const handleCreateMasterValue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMasterForm.value.trim()) return;

    try {
      const res = await fetch('/api/master-values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newMasterForm.type,
          value: newMasterForm.value.trim(),
          isActive: true,
        }),
      });

      if (res.ok) {
        setNewMasterForm((prev) => ({ ...prev, value: '' }));
        fetchMasterValues();
        showToast(`Added new option to ${newMasterForm.type}!`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(`Error: ${data.error || 'Failed to add option'}`);
      }
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to add option');
    }
  };

  // Toggle active status for Master Value (Admin)
  const handleToggleMasterActive = async (id: number, currentActive: boolean) => {
    try {
      const res = await fetch('/api/master-values', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: !currentActive }),
      });
      if (res.ok) {
        setMasterList((prev) =>
          prev.map((m) => (m.id === id ? { ...m, isActive: !currentActive } : m))
        );
        fetchMasterValues();
        showToast(`Updated active state for option #${id}`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(`Error: ${data.error || 'Failed to update option'}`);
      }
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to update option');
    }
  };

  // Edit value string for Master Value (Admin)
  const handleUpdateMasterValue = async (id: number, newValue: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/master-values', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value: newValue.trim() }),
      });
      if (res.ok) {
        setMasterList((prev) =>
          prev.map((m) => (m.id === id ? { ...m, value: newValue.trim() } : m))
        );
        fetchMasterValues();
        showToast(`Updated option #${id} value to "${newValue.trim()}"`);
        return true;
      }
      const data = await res.json().catch(() => ({}));
      showToast(`Error: ${data.error || 'Failed to update option'}`);
      return false;
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to update option');
      return false;
    }
  };

  // Delete Master Value (Admin) - confirmed and written to the audit log server-side
  const handleDeleteMasterValue = (id: number) => {
    const target = masterList.find((m) => m.id === id);
    setConfirmState({
      title: 'Delete dropdown option?',
      message: (
        <>
          Delete {target?.type || 'master'} option <strong>&quot;{target?.value || '#' + id}&quot;</strong>?
        </>
      ),
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/master-values?id=${id}`, {
            method: 'DELETE',
          });
          if (res.ok) {
            setMasterList((prev) => prev.filter((m) => m.id !== id));
            fetchMasterValues();
            showToast(`Deleted master option #${id}`);
            if (activeTab === 'logs') fetchLogs();
          } else {
            const data = await res.json().catch(() => ({}));
            showToast(`Error: ${data.error || 'Failed to delete option'}`);
          }
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Fetch Next Auto-Incremental Docket Number
  const fetchNextDocketNo = async () => {
    try {
      const res = await fetch('/api/dockets/next-number');
      const data = await res.json();
      if (data.nextDocketNo) {
        setNextDocketNo(data.nextDocketNo);
        setNewDocketForm((prev) => ({ ...prev, docketNoQtnNo: data.nextDocketNo }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Dockets
  // Filter params of the Dockets screen (no page / sort) - also what its filter dropdowns are computed under.
  const docketFilterParams = () => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    for (const key of DOCKET_FILTER_KEYS) {
      const vals = docketFilters[key];
      // Attachments is yes/no: both boxes ticked means "no filter".
      if (key === 'attachments') {
        if (vals.length === 1) params.append(key, vals[0]);
      } else vals.forEach((v) => params.append(key, v));
    }
    return params;
  };

  const fetchDockets = async () => {
    docketsAbortRef.current?.abort();
    const controller = new AbortController();
    docketsAbortRef.current = controller;
    setDocketsLoading(true);
    try {
      const params = docketFilterParams();
      params.append('page', String(docketPage));
      params.append('limit', String(docketLimit));
      if (docketSort) {
        params.append('sort', docketSort.key);
        params.append('dir', docketSort.dir);
      }

      const res = await fetch(`/api/dockets?${params.toString()}`, { signal: controller.signal });
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok || !data.dockets) throw new Error(data.error || 'Failed to load dockets');
      setDocketsError(null);
      setDockets(data.dockets);
      // Items arrive with their dockets; the table reads them from this map (edits patch it in place).
      setDocketItemsMap(
        Object.fromEntries(
          (data.dockets as DockerParty[]).filter((d) => d.docketNoQtnNo).map((d) => [d.docketNoQtnNo, d.items ?? []])
        )
      );
      setDocketTotalCount(data.totalCount ?? data.dockets.length);
      setDocketTotalItems(data.totalItems ?? 0);
      setDocketTotalPages(data.totalPages || 1);
      if (data.states) setStateOptions(data.states);
      if (data.docketsList) setDocketOptions(data.docketsList);
      if (data.parties) setPartyOptions(data.parties);
      if (data.utilities) setUtilityOptions(data.utilities);
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error(err);
      // The rows already on screen stay; the table shows a retry bar.
      setDocketsError(err?.message || 'Failed to load dockets');
    } finally {
      if (docketsAbortRef.current === controller) setDocketsLoading(false);
    }
  };

  // Fetch Items belonging to a specific docket number for sub-table accordion
  // Returns the fetched items (null when skipped, failed or superseded by a newer request).
  const fetchItemsForDocket = async (docketNo: string, forceRefresh: boolean = false): Promise<Item[] | null> => {
    if (!docketNo || (!forceRefresh && docketItemsMap[docketNo] && docketItemsMap[docketNo].length > 0)) return null;
    docketItemsAbortRef.current[docketNo]?.abort();
    const controller = new AbortController();
    docketItemsAbortRef.current[docketNo] = controller;
    try {
      const res = await fetch(`/api/items?docketNoQtnNo=${encodeURIComponent(docketNo.trim())}&limit=1000`, {
        signal: controller.signal,
      });
      const data = await res.json();
      if (controller.signal.aborted) return null;
      if (data.items) {
        setDocketItemsMap((prev) => ({ ...prev, [docketNo]: data.items }));
        return data.items as Item[];
      }
      return null;
    } catch (err) {
      if (!controller.signal.aborted) console.error(err);
      return null;
    } finally {
      if (docketItemsAbortRef.current[docketNo] === controller) {
        delete docketItemsAbortRef.current[docketNo];
      }
    }
  };

  // Fetch Terms
  const fetchTerms = async () => {
    setTermsLoading(true);
    try {
      const res = await fetch('/api/terms');
      const data = await res.json();
      if (data.terms) setTerms(data.terms);
      if (data.dropdowns) setTermsDropdowns(data.dropdowns);
    } catch (err) {
      console.error(err);
    } finally {
      setTermsLoading(false);
    }
  };

  // Fetch Edit Logs
  const fetchLogs = async () => {
    logsAbortRef.current?.abort();
    const controller = new AbortController();
    logsAbortRef.current = controller;
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (logTableFilter) params.append('tableName', logTableFilter);
      if (search) params.append('search', search);

      const res = await fetch(`/api/logs?${params.toString()}`, { signal: controller.signal });
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (data.logs) setLogs(data.logs);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error(err);
    } finally {
      if (logsAbortRef.current === controller) setLogsLoading(false);
    }
  };

  const handleTabSwitch = (tab: 'dockets' | 'terms' | 'logs' | 'master') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.pushState(null, '', url.pathname + url.search);
    }
  };

  // A write (POST/PUT/PATCH/DELETE) that comes back 401 (not signed in, session expired, user disabled)
  // sends the user to /login. A 401 on a read (e.g. the Logs tab for a guest) must NOT redirect:
  // viewing is public, so guests stay on the page.
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await originalFetch(...args);
      // Logs are login-only by design; a visitor's 401 there must not bounce the public dashboard to /login.
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (res.status === 401 && !url.includes('/api/logs')) {
        const next = window.location.pathname + window.location.search;
        window.location.href = `/login?next=${encodeURIComponent(next)}`;
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Legacy client-side "session" from the old hardcoded login; no longer trusted.
      try {
        localStorage.removeItem('ceebuild_user');
      } catch {}

      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab') as any;
      if (tabParam && ['dockets', 'terms', 'logs', 'master'].includes(tabParam)) {
        setActiveTab(tabParam);
      }

      const urlFilters = emptyDocketFilters();
      for (const key of DOCKET_FILTER_KEYS) urlFilters[key] = urlParams.getAll(key);
      setDocketFilters(urlFilters);
      setSearch(urlParams.get('search') || '');
      setStartDate(urlParams.get('startDate') || '');
      setEndDate(urlParams.get('endDate') || '');
      const [sortKey, sortDir] = (urlParams.get('sort') || '').split(':');
      if (['docketNoQtnNo', 'createdAt', 'partyName', 'state', 'type'].includes(sortKey)) {
        setDocketSort({ key: sortKey as DocketSort['key'], dir: sortDir === 'asc' ? 'asc' : 'desc' });
      }
      setDocketPage(Math.max(1, Number(urlParams.get('page')) || 1));
      try {
        const size = Number(localStorage.getItem(STORE_DOCKET_PAGE_SIZE));
        if ([25, 50, 100, 200].includes(size)) setDocketLimit(size);
      } catch {}
    }

    // LEGACY (custom cookie auth, replaced by NextAuth on 2026-11-17):
    // fetch('/api/auth/me') ... and, with no user, window.location.href = '/login';
    // DB-checked session (same check as the Orders pages); { user: null } for guests or a stale cookie.
    fetch('/api/session-user', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setCurrentUser({
            username: data.user.username,
            name: data.user.name,
            id: `USR-${data.user.id}`,
            role: data.user.role,
          });
        }
      })
      .catch((err) => console.error('Failed to load session:', err))
      .finally(() => setAuthLoading(false));

    // Fetch counts and master values for all tabs on mount
    fetchMasterValues();
    fetchNextDocketNo();
    fetchDockets();
    fetchTerms();
    fetchLogs();
  }, []);

  useEffect(() => {
    if (activeTab === 'dockets') fetchDockets();
    else if (activeTab === 'terms') fetchTerms();
    else if (activeTab === 'logs') fetchLogs();
    else if (activeTab === 'master') fetchMasterValues();
  }, [activeTab, search, startDate, endDate, docketFilters, docketSort, logTableFilter, docketPage, docketLimit]);

  // Guests (not signed in) who try to edit are sent to the login page and brought back here afterwards.
  // Signed-in Viewers are read-only by role, so they only get a message.
  const readOnlyToast = () => {
    if (!isLoggedIn) {
      showToast('Please sign in to edit data.');
      const next = window.location.pathname + window.location.search;
      window.location.href = `/login?next=${encodeURIComponent(next)}`;
      return;
    }
    showToast('Error: You have read-only access. Ask an Admin for edit rights.');
  };

  // General field updater for ItemTable. Resolves false when the save was refused or failed.
  const handleItemFieldUpdate = async (
    id: number,
    field: keyof Item,
    value: string,
    docketNo?: string | null,
    silent = false // the Dockets table shows its own "Saved - Undo" toast
  ): Promise<boolean> => {
    if (!canEdit) {
      readOnlyToast();
      return false;
    }
    const currentItem = Object.values(docketItemsMap).flat().find((i) => i.id === id);
    if (currentItem && (currentItem[field] ?? '') === value) return true;

    try {
      const res = await fetch('/api/items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
      if (res.ok) {
        // Keep every cached docket sub-table in sync (the item may be cached even when edited from the Items tab).
        setDocketItemsMap((prev) => {
          const copy = { ...prev };
          Object.keys(copy).forEach((dNo) => {
            if (copy[dNo].some((it) => it.id === id)) {
              copy[dNo] = copy[dNo].map((it) => (it.id === id ? { ...it, [field]: value } : it));
            }
          });
          return copy;
        });
        if (!silent) showToast(`Item #${id} updated in DB by ${currentUser.name}`);
        if (activeTab === 'logs') fetchLogs();
        return true;
      }
      const data = await res.json().catch(() => ({}));
      showToast(`Error: ${data.error || `Failed to update item #${id}`}`);
      return false;
    } catch (err) {
      console.error(err);
      showToast(`Error: Failed to update item #${id}`);
      return false;
    }
  };

  // Saves several item rows in parallel; returns how many failed and the first server error.
  const persistItemUpdates = async (updates: Array<{ id: number; fields: Partial<Item> }>) => {
    const results = await Promise.all(
      updates.map(async (up): Promise<string | null> => {
        try {
          const res = await fetch('/api/items', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: up.id, ...up.fields }),
          });
          if (res.ok) return null;
          const data = await res.json().catch(() => ({}));
          return data.error || `Failed to save item #${up.id}`;
        } catch (err: any) {
          return err?.message || `Failed to save item #${up.id}`;
        }
      })
    );
    const errors = results.filter((r): r is string => !!r);
    return { failed: errors.length, firstError: errors[0] || null };
  };

  // Saves several item rows of one docket at once (grid paste and its undo in the Dockets table).
  // Shows the new values immediately; on failure reverts to what the database holds.
  const applyItemUpdates = async (docketNo: string, updates: ItemUpdate[]): Promise<boolean> => {
    if (!canEdit) {
      readOnlyToast();
      return false;
    }
    const patch = (it: Item) => {
      const up = updates.find((u) => u.id === it.id);
      return up ? { ...it, ...up.fields } : it;
    };
    setDocketItemsMap((prev) => (prev[docketNo] ? { ...prev, [docketNo]: prev[docketNo].map(patch) } : prev));

    const { failed, firstError } = await persistItemUpdates(updates);
    if (activeTab === 'logs') fetchLogs();
    if (failed === 0) return true;
    showToast(`Error: ${failed} of ${updates.length} rows were not saved: ${firstError}`);
    fetchItemsForDocket(docketNo, true);
    fetchDockets();
    return false;
  };

  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const uploadOneAttachment = async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload attachment');
      return data.filename;
    } catch (err: any) {
      console.error('Attachment upload error:', err);
      showToast(`Error uploading "${file.name}": ${err.message || 'Upload failed'}`);
      return null;
    }
  };

  // Uploads several files in parallel; returns the stored keys of the ones that succeeded.
  const handleUploadDocketAttachments = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    setUploadingAttachment(true);
    try {
      showToast(`Uploading ${files.length} attachment${files.length > 1 ? 's' : ''} to S3 server...`);
      const results = await Promise.all(files.map(uploadOneAttachment));
      const uploaded = results.filter((k): k is string => !!k);
      if (uploaded.length > 0) {
        showToast(`✨ Uploaded ${uploaded.length} of ${files.length} attachment${files.length > 1 ? 's' : ''}`);
      }
      return uploaded;
    } finally {
      setUploadingAttachment(false);
    }
  };

  const attachmentDisplayName = (key: string) => {
    const parts = key.split('_');
    return parts.length > 2 ? parts.slice(2).join('_') : key;
  };

  const parseAttachments = (attachmentsStr?: string | null): string[] => {
    if (!attachmentsStr) return [];
    try {
      if (attachmentsStr.trim().startsWith('[')) {
        return JSON.parse(attachmentsStr);
      }
      return attachmentsStr.split(',').map((s) => s.trim()).filter(Boolean);
    } catch (e) {
      return [attachmentsStr];
    }
  };

  // Served through our own /api/attachments proxy so the file opens inside the app (same origin).
  const getAttachmentUrl = (filename: string, download = false) => {
    if (!filename) return '#';
    if (filename.startsWith('http://') || filename.startsWith('https://')) return filename;
    return `/api/attachments/${encodeURIComponent(filename)}${download ? '?download=1' : ''}`;
  };

  // General field updater for DockerPartyName
  const handleDocketFieldUpdate = async (id: number, field: keyof DockerParty, value: string, silent = false): Promise<boolean> => {
    if (!canEdit) {
      readOnlyToast();
      return false;
    }
    const currentDoc = dockets.find((d) => d.id === id);
    if (currentDoc && (currentDoc[field] ?? '') === value) return true;
    if (field === 'type' && !isDocketType(value)) {
      showToast('Error: Type is required (Tender or Purchase).');
      return false;
    }

    try {
      const res = await fetch('/api/dockets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
      if (res.ok) {
        setDockets((prev) => prev.map((doc) => (doc.id === id ? { ...doc, [field]: value } : doc)));
        // Renaming a docket moves its items too; refresh the cached sub-table.
        if (field === 'docketNoQtnNo' && currentDoc?.docketNoQtnNo) {
          const oldNo = currentDoc.docketNoQtnNo;
          setDocketItemsMap((prev) => {
            const copy = { ...prev };
            delete copy[oldNo];
            return copy;
          });
        }
        if (!silent) showToast(`Docket Party #${id} updated in DB by ${currentUser.name}`);
        if (activeTab === 'logs') fetchLogs();
        return true;
      }
      const data = await res.json().catch(() => ({}));
      showToast(`Error: ${data.error || 'Failed to update docket'}`);
      return false;
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to update docket');
      return false;
    }
  };

  // Delete Docket & all associated items (Admin only)
  const handleDeleteDocket = async (id: number, docketNo: string | null) => {
    if (currentUser.role !== 'Admin') {
      showToast('Error: Only Admin users can delete dockets.');
      return;
    }

    const docLabel = docketNo || '#' + id;
    const partyName = dockets.find((d) => d.id === id)?.partyName;
    setConfirmState({
      title: `Delete docket ${docLabel}?`,
      message: (
        <>
          This permanently deletes docket <strong>{docLabel}</strong>
          {partyName ? <> ({partyName})</> : null} and <strong>all of its items</strong>.
        </>
      ),
      confirmLabel: 'Delete docket',
      requireText: docketNo || String(id),
      onConfirm: () => performDeleteDocket(id, docketNo),
    });
  };

  const performDeleteDocket = async (id: number, docketNo: string | null) => {
    try {
      const res = await fetch(`/api/dockets?id=${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setDockets((prev) => prev.filter((doc) => doc.id !== id));
        setDocketTotalCount((prev) => Math.max(0, prev - 1));
        if (docketNo) {
          setDocketItemsMap((prev) => {
            const copy = { ...prev };
            delete copy[docketNo];
            return copy;
          });
        }
        const data = await res.json().catch(() => ({}));
        showToast(
          `Docket ${docketNo || '#' + id} and ${data.deletedItemCount ?? 'all'} associated items deleted (logged in Audit Log).`
        );
        if (activeTab === 'logs') fetchLogs();
      } else {
        const data = await res.json();
        showToast(`Error: ${data.error || 'Failed to delete docket'}`);
      }
    } catch (err) {
      console.error('Error deleting docket:', err);
      showToast('Error: Failed to delete docket');
    }
  };

  // Delete single Item from DB
  const handleDeleteItem = (id: number, docketNo?: string | null) => {
    if (currentUser.role !== 'Admin') {
      showToast('Error: Only Admin users can delete items.');
      return;
    }
    const itemName =
      (docketNo ? (docketItemsMap[docketNo] || []).find((it) => it.id === id)?.itemNameParty : null);
    setConfirmState({
      title: `Delete item #${id}?`,
      message: (
        <>
          Delete item <strong>#{id}</strong>
          {itemName ? <> &quot;{itemName}&quot;</> : null}
          {docketNo ? <> from docket {docketNo}</> : null}?
        </>
      ),
      confirmLabel: 'Delete item',
      onConfirm: () => performDeleteItem(id, docketNo),
    });
  };

  const performDeleteItem = async (id: number, docketNo?: string | null) => {
    try {
      const res = await fetch(`/api/items?id=${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        if (docketNo) {
          setDocketItemsMap((prev) => ({
            ...prev,
            [docketNo]: (prev[docketNo] || []).filter((item) => item.id !== id),
          }));
        }
        showToast(`Item #${id} permanently deleted.`);
        if (activeTab === 'logs') fetchLogs();
      } else {
        const data = await res.json();
        showToast(`Error: ${data.error || 'Failed to delete item'}`);
      }
    } catch (err) {
      console.error('Error deleting item:', err);
      showToast('Error: Failed to delete item');
    }
  };

  // General field updater for Terms
  const handleTermFieldUpdate = async (id: number, field: keyof TermCondition, value: string): Promise<boolean> => {
    if (!canEdit) {
      readOnlyToast();
      return false;
    }
    const currentTerm = terms.find((t) => t.id === id);
    if (currentTerm && (currentTerm[field] ?? '') === value) return true;

    try {
      const res = await fetch('/api/terms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
      if (res.ok) {
        setTerms((prev) => prev.map((term) => (term.id === id ? { ...term, [field]: value } : term)));
        showToast(`Terms Option #${id} updated in DB`);
        fetchTerms();
        return true;
      }
      const data = await res.json().catch(() => ({}));
      showToast(`Error: ${data.error || 'Failed to update terms option'}`);
      return false;
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to update terms option');
      return false;
    }
  };

  // Dynamically load SheetJS (XLSX) library on demand
  const loadXLSX = async () => {
    if ((window as any).XLSX) return (window as any).XLSX;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => resolve((window as any).XLSX);
      script.onerror = reject;
      document.body.appendChild(script);
    });
  };

  // Smart Column Header Tracking & Mapper for Excel / CSV / TSV matrices
  const parseTabularDataWithHeaderTracking = (matrix: string[][]) => {
    if (!matrix || matrix.length === 0) return [];

    const cleanMatrix = matrix.filter(
      (row) => Array.isArray(row) && row.some((cell) => cell && String(cell).trim() !== '')
    );
    if (cleanMatrix.length === 0) return [];

    let headerIndex = -1;
    const colMap: { [key: number]: string } = {};

    const normalizeHeader = (str: string) => (str || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

    for (let r = 0; r < Math.min(3, cleanMatrix.length); r++) {
      const row = cleanMatrix[r];
      let matchesCount = 0;
      const tempMap: { [key: number]: string } = {};

      row.forEach((cell, cIndex) => {
        const norm = normalizeHeader(cell || '');
        if (!norm) return;

        // Order matters: "Our item/Not" and "Our item Name" both contain "item", and "ouritemname"
        // contains "itemname", so the specific "our item" headers are matched before the party item name.
        if (norm.includes('ouritemnot') || norm.includes('mfgtrading') || norm.includes('ouritemornot')) {
          tempMap[cIndex] = 'ourItemNot';
          matchesCount++;
        } else if (
          norm.includes('ouritemname') ||
          norm.includes('ouritem') ||
          norm.includes('category') ||
          norm.includes('standardname')
        ) {
          tempMap[cIndex] = 'ourItemName';
          matchesCount++;
        } else if (norm === 'typeofitem' || norm === 'itemtype') {
          tempMap[cIndex] = 'typeOfItem';
          matchesCount++;
        } else if (
          norm.includes('itemnameparty') ||
          norm.includes('partyitemname') ||
          norm.includes('itemname') ||
          norm.includes('partyitem') ||
          norm.includes('description') ||
          norm.includes('particulars') ||
          norm === 'items' ||
          norm === 'item'
        ) {
          tempMap[cIndex] = 'itemNameParty';
          matchesCount++;
        } else if (norm === 'uom' || norm.includes('unitof') || norm === 'unit' || norm === 'units' || norm === 'uomofqtn') {
          tempMap[cIndex] = 'uom';
          matchesCount++;
        } else if (norm === 'qty' || norm.includes('quantity') || norm === 'quantities' || norm === 'nos') {
          tempMap[cIndex] = 'qty';
          matchesCount++;
        } else if (norm === 'size' || norm.includes('spec') || norm.includes('dimension')) {
          tempMap[cIndex] = 'size';
          matchesCount++;
        } else if (norm.includes('member') || norm.includes('ofmember') || norm.includes('wtofmember') || norm.includes('memberwt')) {
          tempMap[cIndex] = 'unitWtOfMemberKg';
          matchesCount++;
        } else if (
          norm.includes('unitwt') ||
          norm.includes('unitweight') ||
          norm.includes('weightperpiece') ||
          norm.includes('weightperpc') ||
          norm.includes('weightpc') ||
          norm === 'weight' ||
          norm === 'wt'
        ) {
          tempMap[cIndex] = 'weightPerPiece';
          matchesCount++;
        } else if (
          norm === 'price' ||
          norm === 'rate' ||
          norm.includes('rateunit') ||
          norm.includes('unitprice') ||
          norm.includes('pricers') ||
          norm.includes('raters')
        ) {
          tempMap[cIndex] = 'price';
          matchesCount++;
        } else if (norm.includes('sectionmm') || norm === 'section') {
          tempMap[cIndex] = 'sectionMm';
          matchesCount++;
        } else if (norm.includes('sectionalwt')) {
          tempMap[cIndex] = 'sectionalWtKgMtr';
          matchesCount++;
        } else if (norm.includes('length')) {
          tempMap[cIndex] = 'lengthInMtr';
          matchesCount++;
        } else if (norm === 'status') {
          tempMap[cIndex] = 'status';
          matchesCount++;
        }
      });

      if (matchesCount >= 1) {
        headerIndex = r;
        Object.assign(colMap, tempMap);
        break;
      }
    }

    const startRow = headerIndex >= 0 ? headerIndex + 1 : 0;
    const result: Array<any> = [];

    for (let i = startRow; i < cleanMatrix.length; i++) {
      const row = cleanMatrix[i];

      if (headerIndex >= 0 && Object.keys(colMap).length > 0) {
        const itemRow: any = {
          itemNameParty: '',
          uom: '',
          qty: '',
          ourItemNot: '',
          ourItemName: '',
          size: '',
          weightPerPiece: '',
          unitWtOfMemberKg: '',
          price: '',
          sectionMm: '',
          sectionalWtKgMtr: '',
          lengthInMtr: '',
          status: '',
        };

        row.forEach((cellVal, colIdx) => {
          const val = cellVal ? String(cellVal).trim() : '';
          const fieldKey = colMap[colIdx];
          if (fieldKey) {
            itemRow[fieldKey] = val;
          }
        });

        if (!itemRow.itemNameParty && row[0]) {
          itemRow.itemNameParty = String(row[0]).trim();
        }

        if (itemRow.itemNameParty || itemRow.qty || itemRow.price) {
          result.push(itemRow);
        }
      } else {
        const itemName = row[0] ? String(row[0]).trim() : '';
        const uom = row[1] ? String(row[1]).trim() : '';
        const qty = row[2] ? String(row[2]).trim() : '';
        const ourItemNot = row[3] ? String(row[3]).trim() : '';
        const ourItemName = row[4] ? String(row[4]).trim() : '';
        const size = row[5] ? String(row[5]).trim() : '';
        const weightPerPiece = row[6] ? String(row[6]).trim() : '';
        const unitWtOfMemberKg = row[7] ? String(row[7]).trim() : '';
        const price = row[8] ? String(row[8]).trim() : '';

        if (itemName || qty || uom) {
          result.push({
            itemNameParty: itemName,
            uom: uom,
            qty: qty,
            ourItemNot: ourItemNot,
            ourItemName: ourItemName,
            size: size,
            weightPerPiece: weightPerPiece,
            unitWtOfMemberKg: unitWtOfMemberKg,
            price: price,
            status: '',
          });
        }
      }
    }

    return result;
  };

  // Excel / CSV File Drag & Drop Handler with Smart Header Tracking
  const handleDropExcelFile = async (file: File) => {
    try {
      showToast(`Reading Excel file "${file.name}"...`);
      const XLSX = await loadXLSX();
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const matrix: string[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
      const parsedItems = parseTabularDataWithHeaderTracking(matrix);

      if (parsedItems.length > 0) {
        setDocketItemsForm(parsedItems);
        showToast(`✨ Tracked headers & auto-filled ${parsedItems.length} item boxes from "${file.name}"!`);
      } else {
        showToast(`Warning: No valid item rows found in file "${file.name}".`);
      }
    } catch (err: any) {
      console.error('Excel parse error:', err);
      showToast(`Error reading Excel file: ${err.message || 'Invalid format'}`);
    }
  };

  // Clipboard Paste Handler with Smart Column Header Tracking
  const handlePasteItems = (
    e: React.ClipboardEvent,
    rowIndex: number,
    targetField?: string
  ) => {
    const pasteData = e.clipboardData.getData('text');
    if (!pasteData) return;

    if (!pasteData.includes('\t') && !pasteData.includes('\n')) {
      return; // Single value paste
    }

    e.preventDefault();
    const rawLines = pasteData.split(/\r?\n/).filter((l) => l.trim() !== '');
    const matrix = rawLines.map((line) => line.split('\t').map((cell) => cell.replace(/^"+|"+$/g, '').trim()));

    const parsedItems = parseTabularDataWithHeaderTracking(matrix);
    if (parsedItems.length === 0) return;

    const newRows = [...docketItemsForm];

    parsedItems.forEach((parsed, idx) => {
      const targetIndex = rowIndex + idx;
      if (targetIndex < newRows.length) {
        newRows[targetIndex] = {
          ...newRows[targetIndex],
          ...parsed,
        };
      } else {
        newRows.push(parsed);
      }
    });

    setDocketItemsForm(newRows);
    showToast(`✨ Auto-filled ${parsedItems.length} item boxes from Excel clipboard!`);
  };

  const handleOpenAddDocketModal = () => {
    fetchNextDocketNo();
    setDocketItemsForm([
      { itemNameParty: '', uom: '', qty: '', ourItemNot: '', ourItemName: '', size: '', weightPerPiece: '', unitWtOfMemberKg: '', price: '' },
    ]);
    setDocketItemViewMode('boxes');
    setShowAddDocketModal(true);
  };

  // Create new Docket Party handler (Supports bulk items creation & user logging)
  const handleCreateDocket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDocketType(newDocketForm.type)) {
      showToast('Error: Please select a Type (Tender or Purchase) for the docket.');
      return;
    }
    try {
      const validItems = docketItemsForm.filter(
        (it) => it.itemNameParty && it.itemNameParty.trim() !== ''
      );

      const payload = {
        ...newDocketForm,
        items: validItems,
      };

      const res = await fetch('/api/dockets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const created = data.docket;
        setShowAddDocketModal(false);
        setNewDocketForm({
          docketNoQtnNo: '',
          partyName: '',
          address: '',
          state: '',
          utility: '',
          deliveryLocation: '',
          type: '',
          price: '',
          payment: '',
          delivery: '',
          warranty: '',
          approval: '',
          inspection: '',
        });
        setDocketItemsForm([{ itemNameParty: '', uom: '', qty: '' }]);
        fetchDockets();
        fetchNextDocketNo();
        showToast(
          data.renumbered
            ? `Docket number ${data.requestedDocketNo} was taken; saved as ${created.docketNoQtnNo} (with ${data.createdItemsCount || 0} items).`
            : `Created Docket #${created.id} (${created.docketNoQtnNo}) with ${data.createdItemsCount || 0} items by ${currentUser.name}!`
        );
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(`Error: ${data.error || 'Failed to create docket'}`);
      }
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to create docket');
    }
  };

  // Create new Item under Docket handler
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItemForm),
      });
      if (res.ok) {
        const created = await res.json();
        setShowAddItemModal(false);
        const targetDocketNo = newItemForm.docketNoQtnNo;
        setNewItemForm({
          docketNoQtnNo: '',
          itemNameParty: '',
          uom: '',
          qty: '',
          ourItemNot: '',
          typeOfItem: '',
          ourItemName: '',
          size: '',
          weightPerPiece: '',
          price: '',
          uomOfQtn: '',
          status: '',
        });
        if (targetDocketNo) {
          fetchItemsForDocket(targetDocketNo, true);
          fetchDockets();
        }
        showToast(`Created Item #${created.id} under Docket ${targetDocketNo || 'N/A'}!`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(`Error: ${data.error || 'Failed to create item'}`);
      }
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to create item');
    }
  };

  // Add new Term Condition
  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTerm),
      });
      if (res.ok) {
        setShowAddTerm(false);
        setNewTerm({ price: '', payment: '', delivery: '', warranty: '', approval: '', inspection: '' });
        fetchTerms();
        showToast('New Terms & Conditions preset created in DB!');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(`Error: ${data.error || 'Failed to create terms preset'}`);
      }
    } catch (err) {
      console.error(err);
      showToast('Error: Failed to create terms preset');
    }
  };

  // ---- Dockets screen glue (the table itself lives in src/modules/dockets) ----
  // Every filter or sort change returns to page 1 in the same handler, so it costs one request.
  const setDocketSearch = (value: string) => {
    setSearch(value);
    setDocketPage(1);
  };
  const setDocketDates = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setDocketPage(1);
  };
  const setDocketFilterValues = (next: DocketFilters) => {
    setDocketFilters(next);
    setDocketPage(1);
  };
  const setDocketSortAndReset = (next: DocketSort | null) => {
    setDocketSort(next);
    setDocketPage(1);
  };
  const changeDocketLimit = (size: number) => {
    setDocketLimit(size);
    setDocketPage(1);
    try {
      localStorage.setItem(STORE_DOCKET_PAGE_SIZE, String(size));
    } catch {}
  };
  const clearDocketFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setDocketFilters(emptyDocketFilters());
    setDocketPage(1);
  };

  // Rebuilt every render and read through a ref, so table rows keep stable callbacks.
  const docketActionsRef = useRef<DocketActions>(null!);
  docketActionsRef.current = {
    refresh: () => void fetchDockets(),
    updateItem: (id, field, value, docketNo) => handleItemFieldUpdate(id, field, value, docketNo, true),
    applyItemUpdates,
    updateDocket: (id, field, value) => handleDocketFieldUpdate(id, field, value, true),
    addDocket: handleOpenAddDocketModal,
    addItem: (docketNo) => {
      setNewItemForm((prev) => ({ ...prev, docketNoQtnNo: docketNo }));
      setShowAddItemModal(true);
    },
    aiAutofill: (docketNo) => void handleAiAutofill(docketNo),
    deleteDocket: (doc) => void handleDeleteDocket(doc.id, doc.docketNoQtnNo),
    deleteItem: (item, docketNo) => handleDeleteItem(item.id, docketNo),
    openAttachments: setAttachmentListDocId,
    uploadAttachments: async (docketId, files) => {
      const uploaded = await handleUploadDocketAttachments(files);
      if (uploaded.length === 0) return;
      // Read the latest list (not this render's closure) so concurrent uploads aren't lost.
      const latest = docketsRef.current.find((d) => d.id === docketId);
      await handleDocketFieldUpdate(docketId, 'attachments', JSON.stringify([...parseAttachments(latest?.attachments), ...uploaded]));
    },
    openReasoning: (item, category) => void openReasoningModal(item.itemNameParty, item.typeOfItem, category),
    confirm: setConfirmState,
  };

  // Dockets filters, sort and page live in the URL, so a view can be bookmarked and shared.
  const docketUrlFirstRun = useRef(true);
  useEffect(() => {
    if (docketUrlFirstRun.current) {
      docketUrlFirstRun.current = false; // the URL is being read by the mount effect; don't overwrite it yet
      return;
    }
    if (activeTab !== 'dockets') return;
    const url = new URL(window.location.href);
    [...DOCKET_FILTER_KEYS, 'search', 'startDate', 'endDate', 'sort', 'page'].forEach((k) => url.searchParams.delete(k));
    docketFilterParams().forEach((value, key) => url.searchParams.append(key, value));
    if (docketSort) url.searchParams.set('sort', `${docketSort.key}:${docketSort.dir}`);
    if (docketPage > 1) url.searchParams.set('page', String(docketPage));
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [activeTab, search, startDate, endDate, docketFilters, docketSort, docketPage]);

  const clearAllFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setDocketFilters(emptyDocketFilters());
    setDocketSort(null);
    setLogTableFilter('');
    setDocketItemsMap({});
    setDocketPage(1);
    fetchDockets();
    fetchMasterValues();
    showToast('Refetched fresh docket & item data from database!');
  };

  // IF AUTH IS LOADING -> SHOW CLEAN SPINNER TO PREVENT FLASHING SIGN IN SCREEN
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium text-slate-500">Loading dashboard…</span>
        </div>
      </div>
    );
  }

  const filteredMasterItems = masterList.filter(
    (m) => m.type === masterCategoryFilter && (search ? m.value.toLowerCase().includes(search.toLowerCase()) : true)
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 lg:flex-row">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-sm font-semibold">
          <CheckCircle className="w-5 h-5 text-emerald-200" />
          <span>{notification}</span>
        </div>
      )}

      {/* AI Processing Overlay Modal & Animation */}
      {aiProcessing && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl border border-blue-100 text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-blue-200 animate-ping opacity-40"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
              <div className="bg-blue-600 text-white p-3.5 rounded-xl shadow-lg">
                <Sparkles className="w-8 h-8" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 flex items-center justify-center gap-2">
                <span>AI Categorization Active</span>
                <span className="text-xs bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full">Groq AI</span>
              </h3>
              <p className="text-xs text-slate-600 font-semibold mt-1">
                {aiProgressText || 'Analyzing raw item descriptions into standard categories...'}
              </p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-full w-full animate-pulse"></div>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              Processing MANUFACTURING & TRADING items with blank predictions
            </p>
          </div>
        </div>
      )}

      {/* AI REASONING EXPLANATION MODAL */}
      {reasoningModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-xl border border-blue-200 shadow-2xl max-w-lg w-full p-6 space-y-5 relative">
            <button
              onClick={() => setReasoningModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-all"
              title="Close / Skip"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
              <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-sm">
                <Brain className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  AI Categorization Reasoning
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Factual Context Explanation (No Speculation)
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
              <div>
                <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px]">
                  Raw Item Description:
                </span>
                <p className="font-semibold text-slate-900 mt-0.5">{reasoningItemText}</p>
              </div>
              <div className="flex items-center space-x-4 pt-1">
                <div>
                  <span className="font-bold text-slate-500 text-[10px]">TYPE OF ITEM:</span>
                  <span className="ml-1 font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                    {reasoningType}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 text-[10px]">ASSIGNED CATEGORY:</span>
                  <span className="ml-1 font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                    {reasoningCategory}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-blue-900 font-semibold text-xs">
                <div className="flex items-center space-x-1.5">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <span>AI Auto-Suggested Reason & User Notes:</span>
                </div>
                <span className="text-[10px] text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full font-bold">
                  Teach AI Knowledge
                </span>
              </div>

              {reasoningLoading ? (
                <div className="flex items-center space-x-3 py-3 text-slate-600 text-xs font-semibold">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <span>Generating factual reasoning strictly from item text...</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    value={reasoningUserNote}
                    onChange={(e) => setReasoningUserNote(e.target.value)}
                    placeholder="Enter or edit why this item belongs to this category to teach AI..."
                    className="w-full text-xs font-semibold text-slate-800 bg-white p-3 rounded-xl border border-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs leading-relaxed"
                  />
                  <p className="text-[10px] text-slate-500 italic">
                    💡 You can edit or add notes above. Saving will teach AI to correctly categorize similar items on future rescans.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setReasoningModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-all"
              >
                Skip / Close
              </button>
              <button
                onClick={handleSaveAiKnowledge}
                disabled={savingKnowledge || reasoningLoading}
                className="flex items-center space-x-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-all shadow-sm"
              >
                {savingKnowledge ? (
                  <span>Saving Rule...</span>
                ) : (
                  <>
                    <Brain className="w-3.5 h-3.5 text-blue-100" />
                    <span>Save & Teach AI</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI STRUCTURAL SECTION CALCULATOR MODAL */}
      {showStructuralModal && structuralQueue.length > 0 && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-xl border border-indigo-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowStructuralModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-all"
              title="Close Flow"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
              <div className="bg-slate-900 p-2.5 rounded-xl text-white shadow-sm">
                <Building className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <span>AI Structural Member Selection</span>
                  <span className="text-xs bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded-full">
                    BOM Item {currentStructuralIndex + 1} of {structuralQueue.length}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  IS 808 Indian Substation Structural Engineer Suggestions
                </p>
              </div>
            </div>

            {/* Current Item Raw Description */}
            <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 space-y-1">
              <span className="font-semibold text-indigo-700 uppercase tracking-wider text-[10px]">
                Target Item Description:
              </span>
              <p className="font-bold text-slate-900 text-xs">
                #{structuralQueue[currentStructuralIndex]?.id} — {structuralQueue[currentStructuralIndex]?.itemNameParty}
              </p>
            </div>

            {/* AI Suggested Options List */}
            {structuralLoading ? (
              <div className="p-8 text-center space-y-3 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  Calculating IS 808 Sectional Weights & REC Cut Lengths for this item...
                </p>
              </div>
            ) : structuralOptions.length === 0 ? (
              <div className="p-5 bg-rose-50 border border-rose-200 rounded-xl space-y-3 text-xs">
                <div className="flex items-center space-x-2 text-rose-800 font-bold">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  <span>
                    {structuralErrorMessage || 'Groq AI returned no structural section options.'}
                  </span>
                </div>
                <p className="text-slate-600 text-[11px]">
                  The Groq API key is configured on the server (GROQ_API_KEY). If the problem persists, ask the administrator.
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      if (structuralQueue[currentStructuralIndex]) {
                        fetchStructuralOptionsForItem(structuralQueue[currentStructuralIndex]);
                      }
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-all shrink-0"
                  >
                    Retry AI
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="font-semibold text-slate-700 text-xs block">
                  Select an IS 808 Standard Member Profile:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1">
                  {structuralOptions.map((opt: any, idx: number) => {
                    const isSelected = selectedStructuralOption === opt;
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedStructuralOption(opt);
                          setCustomStructuralForm({
                            sectionMm: opt.sectionCode || '',
                            sectionalWtKgMtr: opt.sectionalWtKgMtr || '',
                            lengthInMtr: opt.lengthMtr || '',
                            unitWtOfMemberKg: opt.unitWtKg || '',
                          });
                        }}
                        className={`cursor-pointer p-3.5 rounded-xl border transition-all text-xs space-y-1.5 ${
                          isSelected
                            ? 'bg-indigo-50/90 border-indigo-600 shadow-sm ring-2 ring-indigo-500/20'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-indigo-900 font-mono text-xs">
                            {opt.sectionCode}
                          </span>
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                              isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'
                            }`}
                          >
                            {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-600">
                          <div>
                            <span className="block text-[9px] text-slate-400 font-bold">Sec. Wt</span>
                            <span className="font-bold text-slate-800">{opt.sectionalWtKgMtr} Kg/M</span>
                          </div>
                          <div>
                            <span className="block text-[9px] text-slate-400 font-bold">Length</span>
                            <span className="font-bold text-slate-800">{opt.lengthMtr} Mtr</span>
                          </div>
                          <div>
                            <span className="block text-[9px] text-slate-400 font-bold">Unit Wt</span>
                            <span className="font-bold text-indigo-700">{opt.unitWtKg} Kg</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Editable Form Inputs for Selected/Custom Values */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <span className="font-semibold text-slate-700 text-xs block">
                Selected / Customized Values for Item:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">Section (mm)</label>
                  <input
                    type="text"
                    value={customStructuralForm.sectionMm}
                    onChange={(e) =>
                      setCustomStructuralForm((prev) => ({ ...prev, sectionMm: e.target.value }))
                    }
                    placeholder="e.g. CH.125X65X6"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">Sectional Wt (Kg/M)</label>
                  <input
                    type="text"
                    value={customStructuralForm.sectionalWtKgMtr}
                    onChange={(e) => {
                      const secWt = parseFloat(e.target.value) || 0;
                      const len = parseFloat(customStructuralForm.lengthInMtr) || 0;
                      const calculatedUnitWt = secWt && len ? (secWt * len).toFixed(2) : customStructuralForm.unitWtOfMemberKg;
                      setCustomStructuralForm((prev) => ({
                        ...prev,
                        sectionalWtKgMtr: e.target.value,
                        unitWtOfMemberKg: calculatedUnitWt,
                      }));
                    }}
                    placeholder="Kg/Mtr."
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">Length (Mtr)</label>
                  <input
                    type="text"
                    value={customStructuralForm.lengthInMtr}
                    onChange={(e) => {
                      const len = parseFloat(e.target.value) || 0;
                      const secWt = parseFloat(customStructuralForm.sectionalWtKgMtr) || 0;
                      const calculatedUnitWt = secWt && len ? (secWt * len).toFixed(2) : customStructuralForm.unitWtOfMemberKg;
                      setCustomStructuralForm((prev) => ({
                        ...prev,
                        lengthInMtr: e.target.value,
                        unitWtOfMemberKg: calculatedUnitWt,
                      }));
                    }}
                    placeholder="Mtr."
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">Unit Wt (Kg)</label>
                  <input
                    type="text"
                    value={customStructuralForm.unitWtOfMemberKg}
                    onChange={(e) =>
                      setCustomStructuralForm((prev) => ({ ...prev, unitWtOfMemberKg: e.target.value }))
                    }
                    placeholder="Kg"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold text-xs text-indigo-700"
                  />
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <button
                onClick={() => setShowStructuralModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs rounded-xl transition-all"
              >
                Cancel Flow
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSkipStructuralOption}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold text-xs rounded-xl transition-all"
                >
                  Skip Item
                </button>
                <button
                  onClick={handleApplyStructuralOption}
                  disabled={structuralLoading}
                  className="flex items-center space-x-1.5 px-5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-all shadow-sm"
                >
                  {structuralLoading ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-300" />
                      <span>
                        {currentStructuralIndex + 1 < structuralQueue.length ? 'Apply & Next Item' : 'Apply & Finish'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HTML Datalists for Master Value Auto-Suggestions */}
      <datalist id="master-party-names">
        {masterSuggestions.PARTY_NAME.map((val, i) => (
          <option key={i} value={val} />
        ))}
      </datalist>
      <datalist id="master-states">
        {masterSuggestions.STATE.map((val, i) => (
          <option key={i} value={val} />
        ))}
      </datalist>
      <datalist id="master-utilities">
        {masterSuggestions.UTILITY.map((val, i) => (
          <option key={i} value={val} />
        ))}
      </datalist>
      <datalist id="master-addresses">
        {masterSuggestions.ADDRESS.map((val, i) => (
          <option key={i} value={val} />
        ))}
      </datalist>

      <AppSidebar
        user={isLoggedIn ? { name: currentUser.name, role: currentUser.role } : null}
        activeTab={activeTab}
        onTabSelect={handleTabSwitch}
        counts={{
          dockets: docketTotalCount,
          terms: terms.length,
          logs: logs.length,
          master: masterList.length,
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Main Content Container */}
      <main
        className={`flex min-h-0 w-full flex-1 flex-col ${
          activeTab === 'dockets' ? 'overflow-hidden p-3' : 'gap-5 overflow-y-auto px-4 py-6 lg:px-8'
        }`}
      >
        {/* Page title + "Orders & execution" link removed from the dashboard on request (sidebar covers it).
        <PageHeader
        title={TAB_META[activeTab].title}
        description={TAB_META[activeTab].description}
        actions={
        <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
        Orders &amp; execution
        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        </Link>
        }
        />
        */}
        {/* Controls & Filter Bar */}
        {/* The Dockets screen has its own search and date range inside its filter bar. */}
        {activeTab !== 'master' && activeTab !== 'dockets' && (
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Global Search */}
              <div className="relative flex-1 min-w-0 basis-full sm:basis-auto sm:min-w-[280px]">
                <Search className="w-4.5 h-4.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search across all table fields..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setDocketPage(1);
                  }}
                  className="w-full pl-10 pr-4 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Date Range Filter */}
              {activeTab !== 'logs' && (
                <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-1 border border-slate-200 rounded-xl">
                  <div className="flex items-center space-x-1 pl-2 text-slate-500">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-[11px] font-bold">Date:</span>
                  </div>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-slate-400 text-xs font-bold">to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {(startDate || endDate) && (
                    <button
                      onClick={() => {
                        setStartDate('');
                        setEndDate('');
                      }}
                      className="text-xs text-rose-600 hover:text-rose-700 px-1 font-bold"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Reset Filters & Refetch Data */}
              <button
                onClick={clearAllFilters}
                className="flex items-center space-x-1.5 text-xs font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3.5 py-2 rounded-xl transition-all shadow-xs"
                title="Refetch fresh docket and item records directly from PostgreSQL database"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${docketsLoading ? 'animate-spin' : ''}`} />
                <span>Refresh & Reset Data</span>
              </button>
            </div>

          </div>
        )}

        {/* Dockets with their items */}
        {activeTab === 'dockets' && (
          <DocketsTab
            dockets={dockets}
            total={docketTotalCount}
            totalItems={docketTotalItems}
            loading={docketsLoading}
            error={docketsError}
            page={docketPage}
            pageSize={docketLimit}
            onPage={setDocketPage}
            onPageSize={changeDocketLimit}
            search={search}
            onSearch={setDocketSearch}
            startDate={startDate}
            endDate={endDate}
            onDates={setDocketDates}
            filters={docketFilters}
            onFilters={setDocketFilterValues}
            filterQuery={docketFilterParams().toString()}
            onClearFilters={clearDocketFilters}
            sort={docketSort}
            onSort={setDocketSortAndReset}
            itemsByDocket={docketItemsMap}
            canEdit={canEdit}
            isAdmin={currentUser.role === 'Admin'}
            ourItemNames={ourItemNameOptions}
            statuses={masterSuggestions.STATUS}
            termOptions={termsDropdowns}
            uploading={uploadingAttachment}
            actionsRef={docketActionsRef}
          />
        )}

        {/* TAB 3: TREAM-AND-CONDITIONS */}
        {activeTab === 'terms' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col space-y-4 p-5">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold text-slate-900">Terms &amp; Conditions Presets</h2>
                <p className="text-xs text-slate-500 font-medium">
                  Every field is editable. Editing options automatically updates available dropdown choices.
                </p>
              </div>
              {canEdit && (
              <button
                onClick={() => setShowAddTerm(!showAddTerm)}
                className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add Terms Preset</span>
              </button>
              )}
            </div>

            {/* Add Term Form */}
            {showAddTerm && (
              <form onSubmit={handleAddTerm} className="bg-slate-50 p-5 border border-slate-200 rounded-xl space-y-4">
                <h3 className="text-sm font-bold text-slate-800">Add New Terms Condition Option</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-700">Price Condition:</label>
                    <textarea
                      value={newTerm.price}
                      onChange={(e) => setNewTerm((prev) => ({ ...prev, price: e.target.value }))}
                      className="w-full p-2 text-xs border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20"
                      rows={2}
                      placeholder="e.g. Firm and FOR Destination..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Payment Condition:</label>
                    <textarea
                      value={newTerm.payment}
                      onChange={(e) => setNewTerm((prev) => ({ ...prev, payment: e.target.value }))}
                      className="w-full p-2 text-xs border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20"
                      rows={2}
                      placeholder="e.g. 45 days Credit under MSME..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Delivery Condition:</label>
                    <textarea
                      value={newTerm.delivery}
                      onChange={(e) => setNewTerm((prev) => ({ ...prev, delivery: e.target.value }))}
                      className="w-full p-2 text-xs border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20"
                      rows={2}
                      placeholder="e.g. Within 3-4 Weeks..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Warranty Condition:</label>
                    <textarea
                      value={newTerm.warranty}
                      onChange={(e) => setNewTerm((prev) => ({ ...prev, warranty: e.target.value }))}
                      className="w-full p-2 text-xs border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20"
                      rows={2}
                      placeholder="e.g. 12 Months from supply..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Approval Condition:</label>
                    <textarea
                      value={newTerm.approval}
                      onChange={(e) => setNewTerm((prev) => ({ ...prev, approval: e.target.value }))}
                      className="w-full p-2 text-xs border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20"
                      rows={2}
                      placeholder="e.g. In our scope..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Inspection Condition:</label>
                    <textarea
                      value={newTerm.inspection}
                      onChange={(e) => setNewTerm((prev) => ({ ...prev, inspection: e.target.value }))}
                      className="w-full p-2 text-xs border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20"
                      rows={2}
                      placeholder="e.g. In our scope..."
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddTerm(false)}
                    className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-200 rounded-xl font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 text-xs bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 shadow-sm"
                  >
                    Save Options to DB
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-auto flex-1 min-h-[240px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 border-b border-slate-200 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5 min-w-[220px]">Price Condition</th>
                    <th className="p-3.5 min-w-[220px]">Payment Condition</th>
                    <th className="p-3.5 min-w-[220px]">Delivery Condition</th>
                    <th className="p-3.5 min-w-[220px]">Warranty Condition</th>
                    <th className="p-3.5 min-w-[220px]">Approval Condition</th>
                    <th className="p-3.5 min-w-[220px]">Inspection Condition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {termsLoading ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400 font-semibold">
                        Loading terms & conditions presets...
                      </td>
                    </tr>
                  ) : terms.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400 font-semibold">
                        No terms & conditions presets found in database.
                      </td>
                    </tr>
                  ) : (
                    terms.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/90 transition-colors">
                        <td className="p-3.5 font-mono font-bold text-slate-500 text-xs">#{t.id}</td>
                        <td className="p-3.5">
                          <CellInput
                            multiline
                            readOnly={!canEdit}
                            value={t.price || ''}
                            onSave={(val) => handleTermFieldUpdate(t.id, 'price', val)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <CellInput
                            multiline
                            readOnly={!canEdit}
                            value={t.payment || ''}
                            onSave={(val) => handleTermFieldUpdate(t.id, 'payment', val)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <CellInput
                            multiline
                            readOnly={!canEdit}
                            value={t.delivery || ''}
                            onSave={(val) => handleTermFieldUpdate(t.id, 'delivery', val)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <CellInput
                            multiline
                            readOnly={!canEdit}
                            value={t.warranty || ''}
                            onSave={(val) => handleTermFieldUpdate(t.id, 'warranty', val)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <CellInput
                            multiline
                            readOnly={!canEdit}
                            value={t.approval || ''}
                            onSave={(val) => handleTermFieldUpdate(t.id, 'approval', val)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <CellInput
                            multiline
                            readOnly={!canEdit}
                            value={t.inspection || ''}
                            onSave={(val) => handleTermFieldUpdate(t.id, 'inspection', val)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: EDIT-LOGS */}
        {activeTab === 'logs' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-rose-600" />
                  Audit Log (Change History)
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Every create, edit and delete on Items, Dockets, Terms &amp; Conditions and Master Dropdowns is recorded here with the logged-in user.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-600">Filter Table:</span>
                <select
                  value={logTableFilter}
                  onChange={(e) => setLogTableFilter(e.target.value)}
                  className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                >
                  <option value="">All Tables</option>
                  <option value="iteam-table">Items</option>
                  <option value="docket-party-name">Dockets</option>
                  <option value="tream-and-conditions">Terms &amp; Conditions</option>
                  <option value="master-values">Master Dropdowns</option>
                </select>
              </div>
            </div>

            <div className="overflow-auto flex-1 min-h-[240px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 border-b border-slate-200 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5">Log ID</th>
                    <th className="p-3.5">Table Name</th>
                    <th className="p-3.5">Record ID</th>
                    <th className="p-3.5">Field Changed</th>
                    <th className="p-3.5">Old Value</th>
                    <th className="p-3.5">New Value</th>
                    <th className="p-3.5">User</th>
                    <th className="p-3.5">Timestamp</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 font-medium">
                  {!authLoading && !isLoggedIn ? (
                    <tr>
                      <td colSpan={8} className="p-10 text-center text-slate-500 font-semibold">
                        The change history is only visible after signing in.{' '}
                        <Link href="/login?next=%2F%3Ftab%3Dlogs" className="text-blue-600 hover:underline font-bold">
                          Sign in
                        </Link>
                      </td>
                    </tr>
                  ) : logsLoading ? (
                    <tr>
                      <td colSpan={8} className="p-10 text-center text-slate-400 font-semibold">
                        Loading edit logs history...
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-10 text-center text-slate-400 font-semibold">
                        No edit log entries found yet. Edit any table cell to test logging!
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/90 transition-colors">
                        <td className="p-3.5 font-mono text-xs font-bold text-slate-500">#{log.id}</td>
                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                              log.tableName === 'iteam-table'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : log.tableName === 'docket-party-name'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {TABLE_LABELS[log.tableName] || log.tableName}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono font-bold text-slate-700">#{log.recordId}</td>
                        <td className="p-3.5 font-bold text-slate-900 flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-slate-400" />
                          {log.fieldName}
                        </td>
                        <td
                          className="p-3.5 text-rose-700 max-w-[240px] truncate bg-rose-50/40 rounded px-2 py-1"
                          title={log.oldValue || ''}
                        >
                          {log.oldValue || '<EMPTY>'}
                        </td>
                        <td
                          className="p-3.5 text-emerald-700 max-w-[240px] truncate bg-emerald-50/40 rounded px-2 py-1 font-bold"
                          title={log.newValue || ''}
                        >
                          {log.newValue || '<EMPTY>'}
                        </td>
                        <td className="p-3.5 text-xs font-bold text-slate-700 whitespace-nowrap">
                          {log.userName || <span className="text-slate-400 font-medium">legacy / unknown</span>}
                        </td>
                        <td className="p-3.5 text-slate-500 text-xs font-mono whitespace-nowrap">
                          <Clock className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: ADMIN-ONLY MASTER DROPDOWNS MANAGEMENT */}
        {activeTab === 'master' && currentUser.role === 'Admin' && (
          <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden flex flex-col space-y-4 p-6">
            <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-amber-600" />
                  Master Dropdowns Option Manager (Admin Control)
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Add, edit, enable/disable, or delete options for Party Names, States, Utilities, Addresses, and Statuses.
                </p>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: 'PARTY_NAME', label: 'Party Names' },
                  { key: 'STATE', label: 'States' },
                  { key: 'UTILITY', label: 'Utilities' },
                  { key: 'ADDRESS', label: 'Addresses' },
                  { key: 'STATUS', label: 'Statuses' },
                ].map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => setMasterCategoryFilter(cat.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                      masterCategoryFilter === cat.key
                        ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {cat.label} ({masterList.filter((m) => m.type === cat.key).length})
                  </button>
                ))}
              </div>
            </div>

            {/* ADD NEW MASTER OPTION FORM */}
            <form onSubmit={handleCreateMasterValue} className="bg-amber-50/50 border border-amber-200 p-4 rounded-xl space-y-3">
              <h3 className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                <PlusCircle className="w-4 h-4 text-amber-600" />
                Add New Master Option to Database
              </h3>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="w-48">
                  <label className="font-semibold text-slate-700">Category:</label>
                  <select
                    value={newMasterForm.type}
                    onChange={(e) => setNewMasterForm((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white font-bold"
                  >
                    <option value="PARTY_NAME">Party Name</option>
                    <option value="STATE">State</option>
                    <option value="UTILITY">Utility</option>
                    <option value="ADDRESS">Address</option>
                    <option value="STATUS">Status</option>
                  </select>
                </div>

                <div className="flex-1 min-w-[240px]">
                  <label className="font-semibold text-slate-700">New Option Value *:</label>
                  <input
                    type="text"
                    required
                    placeholder={`e.g. New ${masterCategoryFilter} value...`}
                    value={newMasterForm.value}
                    onChange={(e) => setNewMasterForm((prev) => ({ ...prev, value: e.target.value }))}
                    className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white font-bold"
                  />
                </div>

                <div className="pt-5">
                  <button
                    type="submit"
                    className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-5 py-2 rounded-xl text-xs shadow-sm transition-all flex items-center space-x-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Master Option</span>
                  </button>
                </div>
              </div>
            </form>

            {/* MASTER VALUES TABLE */}
            <div className="overflow-x-auto max-h-[600px] border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 border-b border-slate-200 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="p-3 w-[70px]">ID</th>
                    <th className="p-3 w-[160px]">Category</th>
                    <th className="p-3 min-w-[320px]">Option Value</th>
                    <th className="p-3 w-[120px] text-center">Status</th>
                    <th className="p-3 w-[100px] text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {masterListLoading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 font-semibold">
                        Loading master dropdown options...
                      </td>
                    </tr>
                  ) : filteredMasterItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 font-semibold">
                        No master options found for category: {masterCategoryFilter}
                      </td>
                    </tr>
                  ) : (
                    filteredMasterItems.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-bold text-slate-500">#{m.id}</td>
                        <td className="p-3 font-bold text-amber-800">
                          <span className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md text-[11px]">
                            {m.type}
                          </span>
                        </td>
                        <td className="p-3">
                          <AutoResizeTextarea
                            readOnly={!canEdit}
                            defaultValue={m.value}
                            onSave={(newVal) => handleUpdateMasterValue(m.id, newVal)}
                            className="font-bold text-slate-900"
                          />
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleToggleMasterActive(m.id, m.isActive)}
                            className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border ${
                              m.isActive
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                : 'bg-slate-100 text-slate-500 border-slate-300'
                            }`}
                          >
                            {m.isActive ? (
                              <>
                                <ToggleRight className="w-4 h-4 text-emerald-600" />
                                <span>Active</span>
                              </>
                            ) : (
                              <>
                                <ToggleLeft className="w-4 h-4 text-slate-400" />
                                <span>Disabled</span>
                              </>
                            )}
                          </button>
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleDeleteMasterValue(m.id)}
                            className="text-rose-600 hover:text-rose-800 font-bold p-1 rounded hover:bg-rose-50 transition-all"
                            title="Delete Option"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      </div>

      {/* MODAL 1: ADD NEW DOCKET RECORD (WITH EXCEL BULK COPY-PASTE ITEM BOXES & AUTO-INCREMENTAL DOCKET NO) */}
      {showAddDocketModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-3xl w-full p-6 space-y-5 animate-in fade-in zoom-in duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-600 text-white p-2.5 rounded-xl">
                  <Building className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Add New Docket Record</h3>
                  <p className="text-xs text-slate-500">
                    Logged in user: <strong className="text-blue-700">{currentUser.name} ({currentUser.username})</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddDocketModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDocket} className="space-y-5">
              {/* UPPER SECTION: DOCKET & PARTY DETAILS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 flex items-center justify-between">
                    <span>Docket / Qtn No:</span>
                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                      {currentUser.role === 'Admin' ? (
                        <>
                          <Unlock className="w-3 h-3 text-amber-500" /> Admin Editable
                        </>
                      ) : (
                        <>
                          <Lock className="w-3 h-3 text-slate-400" /> Auto-Incremental Read-Only
                        </>
                      )}
                    </span>
                  </label>
                  <input
                    type="text"
                    required
                    readOnly={currentUser.role !== 'Admin'}
                    value={newDocketForm.docketNoQtnNo}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, docketNoQtnNo: e.target.value }))}
                    className={`w-full mt-1 p-2.5 border rounded-xl font-semibold text-xs transition-all ${
                      currentUser.role === 'Admin'
                        ? 'bg-white border-blue-400 text-blue-700 focus:ring-2 focus:ring-blue-500/20'
                        : 'bg-slate-100 border-slate-300 text-slate-600 cursor-not-allowed'
                    }`}
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Party Name *:</label>
                  <input
                    type="text"
                    required
                    list="master-party-names"
                    placeholder="e.g. LASER POWER & INFRA LTD."
                    value={newDocketForm.partyName}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, partyName: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-bold"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="font-semibold text-slate-700">Address:</label>
                  <input
                    type="text"
                    list="master-addresses"
                    placeholder="Full party address..."
                    value={newDocketForm.address}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, address: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">State:</label>
                  <input
                    type="text"
                    list="master-states"
                    placeholder="e.g. West Bengal"
                    value={newDocketForm.state}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, state: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 font-medium"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Utility:</label>
                  <input
                    type="text"
                    list="master-utilities"
                    placeholder="e.g. WBSEDCL / NBPDCL"
                    value={newDocketForm.utility}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, utility: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 font-medium"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Delivery Location:</label>
                  <input
                    type="text"
                    placeholder="e.g. Beldanga and Sitalpur, Bihar"
                    value={newDocketForm.deliveryLocation}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, deliveryLocation: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="new-docket-type" className="font-semibold text-slate-700">
                    Type: <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="new-docket-type"
                    required
                    value={newDocketForm.type}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 text-xs font-bold text-slate-800 invalid:border-rose-400"
                  >
                    <option value="" disabled>
                      Select Type (Tender / Purchase) - required
                    </option>
                    {DOCKET_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Terms Conditions selections */}
                <div>
                  <label className="font-semibold text-slate-700">Price Condition:</label>
                  <select
                    value={newDocketForm.price}
                    title={newDocketForm.price || 'Select Option'}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, price: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white text-xs font-semibold"
                  >
                    <option value="">Select Option</option>
                    {termsDropdowns.price.map((opt, i) => (
                      <option key={i} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Payment Condition:</label>
                  <select
                    value={newDocketForm.payment}
                    title={newDocketForm.payment || 'Select Option'}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, payment: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white text-xs font-semibold"
                  >
                    <option value="">Select Option</option>
                    {termsDropdowns.payment.map((opt, i) => (
                      <option key={i} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* LOWER SECTION: EXCEL DRAG & DROP + SMART HEADER TRACKED ITEM BOXES */}
              <div className="border-t border-slate-200 pt-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-emerald-600" />
                      Add Line Items (Excel Drag & Drop + Copy-Paste + Smart Header Tracking)
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Drag & drop an Excel file or paste rows. Headers automatically map to <span className="font-bold text-slate-700">ITEM NAME, UOM, QTY, OUR ITEM/NOT, Our item Name, SIZE, Unit Wt. of Member (Kg), PRICE</span>.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                      <button
                        type="button"
                        onClick={() => setDocketItemViewMode('boxes')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center space-x-1 transition-all ${
                          docketItemViewMode === 'boxes'
                            ? 'bg-white text-blue-700 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Box Card View"
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        <span>Boxes</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDocketItemViewMode('table')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center space-x-1 transition-all ${
                          docketItemViewMode === 'table'
                            ? 'bg-white text-blue-700 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Table Preview View"
                      >
                        <Table className="w-3.5 h-3.5" />
                        <span>Table</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setDocketItemsForm((prev) => [
                          ...prev,
                          { itemNameParty: '', uom: '', qty: '', ourItemNot: '', ourItemName: '', size: '', unitWtOfMemberKg: '', price: '' },
                        ])
                      }
                      className="inline-flex items-center space-x-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-semibold text-xs px-3 py-1.5 rounded-xl transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Row Box</span>
                    </button>

                    {docketItemsForm.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDocketItemsForm([
                            { itemNameParty: '', uom: '', qty: '', ourItemNot: '', ourItemName: '', size: '', unitWtOfMemberKg: '', price: '' },
                          ])
                        }
                        className="text-xs text-rose-600 font-bold hover:underline px-2"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* EXCEL DRAG & DROP ZONE */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleDropExcelFile(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-3.5 border-2 border-dashed rounded-xl cursor-pointer transition-all text-center flex flex-col items-center justify-center space-y-1 ${
                    isDraggingFile
                      ? 'border-blue-500 bg-blue-50/80 scale-[1.005]'
                      : 'border-blue-300 hover:border-blue-500 bg-blue-50/30 hover:bg-blue-50/60'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleDropExcelFile(e.target.files[0]);
                      }
                    }}
                    accept=".xlsx, .xls, .csv, .tsv, .txt"
                    className="hidden"
                  />
                  <div className="flex items-center space-x-2 text-blue-700 font-semibold text-xs">
                    <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                    <span>Drag & Drop Excel (.xlsx, .xls, .csv) File or Click to Upload & Auto-Fill</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Automatically tracks headers: <span className="font-bold text-slate-700">Item ID | ITEM NAME- PARTY | UOM | QTY | OUR ITEM/NOT | Our item Name | SIZE | Unit Wt. of Member (Kg) | PRICE</span>
                  </p>
                </div>

                {/* VIEW MODE 1: BOX CARDS VIEW */}
                {docketItemViewMode === 'boxes' ? (
                  <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                    {docketItemsForm.map((row, index) => (
                      <div
                        key={index}
                        className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200 relative group space-y-2.5 shadow-2xs hover:border-blue-300 transition-all"
                      >
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                          <span className="flex items-center gap-1.5 text-blue-900">
                            <Package className="w-3.5 h-3.5 text-blue-600" />
                            Item Box #{index + 1}
                          </span>
                          {docketItemsForm.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setDocketItemsForm((prev) => prev.filter((_, i) => i !== index))}
                              className="text-rose-600 hover:text-rose-700 font-bold p-1 rounded hover:bg-rose-50"
                              title="Remove Box"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* FIELDS GRID */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          {/* ITEM NAME - PARTY */}
                          <div className="sm:col-span-2 md:col-span-4">
                            <label className="font-bold text-slate-700">ITEM NAME - PARTY *:</label>
                            <textarea
                              rows={2}
                              placeholder="Paste or type item name..."
                              value={row.itemNameParty || ''}
                              onPaste={(e) => handlePasteItems(e, index)}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, itemNameParty: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 font-bold text-xs resize-y leading-snug"
                            />
                          </div>

                          {/* UOM */}
                          <div>
                            <label className="font-bold text-slate-700">UOM:</label>
                            <input
                              type="text"
                              placeholder="e.g. NOS / SET / kg"
                              value={row.uom || ''}
                              onPaste={(e) => handlePasteItems(e, index)}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, uom: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 text-xs font-semibold"
                            />
                          </div>

                          {/* QTY */}
                          <div>
                            <label className="font-bold text-slate-700">QTY:</label>
                            <input
                              type="text"
                              placeholder="e.g. 100"
                              value={row.qty || ''}
                              onPaste={(e) => handlePasteItems(e, index)}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, qty: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 text-xs font-bold text-slate-900"
                            />
                          </div>

                          {/* OUR ITEM / NOT */}
                          <div>
                            <label className="font-bold text-slate-700">OUR ITEM / NOT:</label>
                            <select
                              value={row.ourItemNot || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, ourItemNot: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 text-xs font-bold"
                            >
                              <option value="">Select Option</option>
                              <option value="MANUFACTURING">MANUFACTURING</option>
                              <option value="NO">NO</option>
                              <option value="TRADING">TRADING</option>
                            </select>
                          </div>

                          {/* Our item Name */}
                          <div>
                            <label className="font-bold text-slate-700">Our Item Name:</label>
                            <select
                              value={row.ourItemName || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, ourItemName: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 text-xs font-semibold text-blue-700"
                            >
                              <option value="">Select Category</option>
                              <option value="OTHERS">OTHERS</option>
                              {ourItemNameOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* SIZE */}
                          <div>
                            <label className="font-bold text-slate-700">SIZE:</label>
                            <input
                              type="text"
                              placeholder="e.g. 100x50mm"
                              value={row.size || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, size: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white text-xs font-medium"
                            />
                          </div>

                          {/* Unit Wt. */}
                          <div>
                            <label className="font-bold text-slate-700">Unit Wt.:</label>
                            <input
                              type="text"
                              placeholder="e.g. 5.2"
                              value={row.weightPerPiece || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, weightPerPiece: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white text-xs font-medium"
                            />
                          </div>

                          {/* Unit Wt. of Member (Kg) */}
                          <div>
                            <label className="font-bold text-slate-700">Unit Wt. of Member (Kg):</label>
                            <input
                              type="text"
                              placeholder="e.g. 12.5"
                              value={row.unitWtOfMemberKg || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, unitWtOfMemberKg: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white text-xs font-medium"
                            />
                          </div>

                          {/* PRICE */}
                          <div>
                            <label className="font-bold text-slate-700">PRICE:</label>
                            <input
                              type="text"
                              placeholder="e.g. 450.00"
                              value={row.price || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDocketItemsForm((prev) =>
                                  prev.map((r, i) => (i === index ? { ...r, price: val } : r))
                                );
                              }}
                              className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white text-xs font-semibold text-blue-900"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* VIEW MODE 2: TABLE PREVIEW VIEW */
                  <div className="overflow-x-auto max-h-[360px] border border-slate-200 rounded-xl bg-white shadow-xs">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 border-b border-slate-200 text-[10px] uppercase">
                        <tr>
                          <th className="p-2 w-8 text-center">#</th>
                          <th className="p-2 min-w-[200px]">ITEM NAME - PARTY *</th>
                          <th className="p-2 w-20">UOM</th>
                          <th className="p-2 w-20">QTY</th>
                          <th className="p-2 w-32">OUR ITEM / NOT</th>
                          <th className="p-2 w-40">Our item Name</th>
                          <th className="p-2 w-28">SIZE</th>
                          <th className="p-2 w-28 bg-blue-50/80 text-blue-900 font-semibold">Unit Wt.</th>
                          <th className="p-2 w-32">Unit Wt. of Member (Kg)</th>
                          <th className="p-2 w-28">PRICE</th>
                          <th className="p-2 w-10 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {docketItemsForm.map((row, index) => (
                          <tr key={index} className="hover:bg-slate-50 transition-colors">
                            <td className="p-2 font-bold text-center text-slate-400">{index + 1}</td>
                            <td className="p-2">
                              <textarea
                                rows={1}
                                value={row.itemNameParty || ''}
                                onPaste={(e) => handlePasteItems(e, index)}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, itemNameParty: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs font-bold focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.uom || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, uom: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.qty || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, qty: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs font-bold"
                              />
                            </td>
                            <td className="p-2">
                              <select
                                value={row.ourItemNot || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, ourItemNot: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs font-bold"
                              >
                                <option value="">Select</option>
                                <option value="MANUFACTURING">MANUFACTURING</option>
                                <option value="NO">NO</option>
                                <option value="TRADING">TRADING</option>
                              </select>
                            </td>
                            <td className="p-2">
                              <select
                                value={row.ourItemName || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, ourItemName: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs font-bold text-blue-700"
                              >
                                <option value="">Select Category</option>
                                <option value="OTHERS">OTHERS</option>
                                {ourItemNameOptions.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.size || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, size: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs"
                              />
                            </td>
                            <td className="p-2 bg-blue-50/30">
                              <input
                                type="text"
                                placeholder="Unit Wt."
                                value={row.weightPerPiece || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, weightPerPiece: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs font-medium"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.unitWtOfMemberKg || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, unitWtOfMemberKg: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.price || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDocketItemsForm((prev) =>
                                    prev.map((r, i) => (i === index ? { ...r, price: val } : r))
                                  );
                                }}
                                className="w-full p-1.5 border border-slate-200 rounded-lg text-xs font-bold text-blue-900"
                              />
                            </td>
                            <td className="p-2 text-center">
                              {docketItemsForm.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setDocketItemsForm((prev) => prev.filter((_, i) => i !== index))}
                                  className="text-rose-600 hover:text-rose-800 p-1 rounded hover:bg-rose-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddDocketModal(false)}
                  className="px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-sm shadow-blue-500/20"
                >
                  Save Docket to DB
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD NEW ITEM TO DOCKET */}
      {showAddItemModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="bg-emerald-600 text-white p-2 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Create Item inside Docket #{newItemForm.docketNoQtnNo || 'N/A'}
                  </h3>
                  <p className="text-xs text-slate-500">Add a new quotation line item to PostgreSQL</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddItemModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="font-semibold text-slate-700">Docket / Qtn No:</label>
                  <input
                    type="text"
                    required
                    value={newItemForm.docketNoQtnNo}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, docketNoQtnNo: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-bold text-blue-600"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">ITEM NAME - PARTY *:</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 11 kV Galvanized Stay Set Complete"
                    value={newItemForm.itemNameParty}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, itemNameParty: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-bold"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">UOM:</label>
                  <input
                    type="text"
                    placeholder="e.g. NOS / kg / SET"
                    value={newItemForm.uom}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, uom: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">QTY:</label>
                  <input
                    type="text"
                    placeholder="e.g. 100"
                    value={newItemForm.qty}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, qty: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-semibold"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">OUR ITEM / NOT:</label>
                  <select
                    value={newItemForm.ourItemNot}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, ourItemNot: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-bold"
                  >
                    <option value="">Select Option</option>
                    <option value="MANUFACTURING">MANUFACTURING</option>
                    <option value="NO">NO</option>
                    <option value="TRADING">TRADING</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Our Item Name:</label>
                  <select
                    value={newItemForm.ourItemName}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, ourItemName: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-bold text-blue-700"
                  >
                    <option value="">Select Item Name</option>
                    {ourItemNameOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Size:</label>
                  <input
                    type="text"
                    placeholder="e.g. 100x50x6mm"
                    value={newItemForm.size}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, size: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Price:</label>
                  <input
                    type="text"
                    placeholder="e.g. 1950"
                    value={newItemForm.price}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, price: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-semibold text-slate-900"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Status:</label>
                  <select
                    value={newItemForm.status}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-bold"
                  >
                    {masterSuggestions.STATUS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold shadow-sm shadow-emerald-500/20"
                >
                  Save Item to Docket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title || ''}
        message={confirmState?.message || null}
        confirmLabel={confirmState?.confirmLabel}
        requireText={confirmState?.requireText}
        onConfirm={confirmState?.onConfirm || (() => {})}
        onClose={() => setConfirmState(null)}
      />

      {(() => {
        const listDoc = attachmentListDocId != null ? dockets.find((d) => d.id === attachmentListDocId) : null;
        if (!listDoc) return null;
        const atts = parseAttachments(listDoc.attachments);
        const closeList = () => setAttachmentListDocId(null);
        return (
          <div
            className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/60 p-4"
            onClick={closeList}
            onKeyDown={(e) => e.key === 'Escape' && closeList()}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Attachments"
              className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
                  <h2 className="truncate text-sm font-semibold text-slate-900">
                    Attachments — {listDoc.docketNoQtnNo || '#' + listDoc.id}
                  </h2>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {atts.length}
                  </span>
                </div>
                <button
                  type="button"
                  autoFocus
                  onClick={closeList}
                  aria-label="Close attachments"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
                {atts.length === 0 ? (
                  <p className="py-6 text-center text-xs font-bold text-slate-400">No attachments</p>
                ) : (
                  atts.map((att, attIdx) => {
                    const displayName = attachmentDisplayName(att);
                    return (
                      <div
                        key={`${att}-${attIdx}`}
                        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/40 px-2.5 py-1.5 text-xs"
                      >
                        <File className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="min-w-0 flex-1 truncate font-bold text-emerald-900" title={displayName}>
                          {displayName}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewAttachment({ key: att, name: displayName })}
                          className="rounded p-1 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-800"
                          title="View"
                          aria-label={`View ${displayName}`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={getAttachmentUrl(att, true)}
                          download={displayName}
                          className="rounded p-1 text-sky-600 hover:bg-sky-100 hover:text-sky-800"
                          title="Download"
                          aria-label={`Download ${displayName}`}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmState({
                              title: 'Remove attachment?',
                              message: (
                                <>
                                  Remove <strong>&quot;{displayName}&quot;</strong> from docket{' '}
                                  {listDoc.docketNoQtnNo || '#' + listDoc.id}?
                                </>
                              ),
                              confirmLabel: 'Remove',
                              onConfirm: async () => {
                                // Use the latest list and remove by key, not by an index from an older render.
                                const latestDoc = docketsRef.current.find((d) => d.id === listDoc.id) || listDoc;
                                const currentAtts = parseAttachments(latestDoc.attachments);
                                const removeIdx = currentAtts.indexOf(att);
                                if (removeIdx === -1) return;
                                const updatedAtts = currentAtts.filter((_, i) => i !== removeIdx);
                                await handleDocketFieldUpdate(listDoc.id, 'attachments' as any, JSON.stringify(updatedAtts));
                              },
                            });
                          }}
                          className="rounded p-1 text-rose-500 hover:bg-rose-100 hover:text-rose-700"
                          title="Remove Attachment"
                          aria-label={`Remove ${displayName}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {previewAttachment && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setPreviewAttachment(null)}
          onKeyDown={(e) => e.key === 'Escape' && setPreviewAttachment(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${previewAttachment.name}`}
            className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <File className="h-4 w-4 shrink-0 text-emerald-600" />
                <h2 className="truncate text-sm font-semibold text-slate-900" title={previewAttachment.name}>
                  {previewAttachment.name}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={getAttachmentUrl(previewAttachment.key, true)}
                  download={previewAttachment.name}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setPreviewAttachment(null)}
                  aria-label="Close preview"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100">
              {/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(previewAttachment.key) ? (
                <div className="flex h-full items-center justify-center overflow-auto p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getAttachmentUrl(previewAttachment.key)}
                    alt={previewAttachment.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <iframe
                  src={getAttachmentUrl(previewAttachment.key)}
                  title={previewAttachment.name}
                  className="h-full w-full border-0"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
