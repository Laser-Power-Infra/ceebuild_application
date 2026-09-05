'use client';

import React, { useState, useEffect } from 'react';
import { autoDetectOurItemNot } from '@/lib/classifier';
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
} from 'lucide-react';
import Link from 'next/link';

interface Item {
  id: number;
  uniqueNo: string | null;
  docketNoQtnNo: string | null;
  itemNameParty: string | null;
  uom: string | null;
  qty: string | null;
  ourItemNot: string | null;
  typeOfItem: string | null;
  ourItemName: string | null;
  size: string | null;
  sectionMm: string | null;
  sectionalWtKgMtr: string | null;
  lengthInMtr: string | null;
  unitWtOfMemberKg: string | null;
  weightPerPiece: string | null;
  price: string | null;
  uomOfQtn: string | null;
  a: string | null;
  freightPerKg: string | null;
  status: string | null;
  createdAt: string;
}

interface DockerParty {
  id: number;
  docketNoQtnNo: string | null;
  partyName: string | null;
  address: string | null;
  state: string | null;
  utility: string | null;
  deliveryLocation: string | null;
  price: string | null;
  payment: string | null;
  delivery: string | null;
  warranty: string | null;
  approval: string | null;
  inspection: string | null;
  firstItemName?: string | null;
  createdAt: string;
}

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
  createdAt: string;
}

interface MasterValueItem {
  id: number;
  type: string;
  value: string;
  isActive: boolean;
  createdAt: string;
}

interface UserRole {
  username: string;
  name: string;
  id: string;
  role: 'Admin' | 'Tanmoy';
}

const AUTH_USERS: Array<UserRole & { password: string }> = [
  { username: 'admin', password: 'admin', name: 'Admin', id: 'USR-ADMIN-01', role: 'Admin' },
  { username: 'tanmoy', password: 'tanmoy', name: 'Tanmoy', id: 'USR-TANMOY-02', role: 'Tanmoy' },
];

// Lightweight auto-resizing text component that avoids browser thread locking
function AutoResizeTextarea({
  defaultValue,
  onSave,
  className = '',
  placeholder = '',
}: {
  defaultValue: string;
  onSave: (val: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [val, setVal] = useState(defaultValue || '');

  useEffect(() => {
    setVal(defaultValue || '');
  }, [defaultValue]);

  return (
    <textarea
      value={val}
      placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onSave(val)}
      rows={val && val.length > 35 ? 2 : 1}
      className={`w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 text-xs font-medium text-slate-900 focus:outline-none resize-y leading-snug transition-all ${className}`}
    />
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'items' | 'dockets' | 'terms' | 'logs' | 'master'>('dockets');

  // Authentication & User State
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<UserRole>({
    username: 'admin',
    name: 'Admin',
    id: 'USR-ADMIN-01',
    role: 'Admin',
  });
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

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
  const [itemPage, setItemPage] = useState(1);
  const [itemLimit, setItemLimit] = useState(50);
  const [itemTotalCount, setItemTotalCount] = useState(0);
  const [itemTotalPages, setItemTotalPages] = useState(1);

  const [docketPage, setDocketPage] = useState(1);
  const [docketLimit, setDocketLimit] = useState(50);
  const [docketTotalCount, setDocketTotalCount] = useState(0);
  const [docketTotalPages, setDocketTotalPages] = useState(1);

  // Items
  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemFilters, setItemFilters] = useState({
    docketNoQtnNo: '',
    itemNameParty: '',
    ourItemNot: '',
    ourItemName: [] as string[],
    status: '',
  });

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
  const [docketsLoading, setDocketsLoading] = useState(false);
  const [docketFilters, setDocketFilters] = useState({
    docketNoQtnNo: '',
    partyName: '',
    itemFilter: '',
    state: '',
  });
  const [stateOptions, setStateOptions] = useState<string[]>([]);

  // Expanded Docket IDs state & items cache map
  const [expandedDocketIds, setExpandedDocketIds] = useState<number[]>([]);
  const [docketItemsMap, setDocketItemsMap] = useState<{ [docketNo: string]: Item[] }>({});
  const [loadingDocketItems, setLoadingDocketItems] = useState<{ [docketNo: string]: boolean }>({});

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
    price: '',
    payment: '',
    delivery: '',
    warranty: '',
    approval: '',
    inspection: '',
  });

  // Dynamic Item Row Boxes in Add Docket Modal (Supports Excel Copy-Paste)
  const [docketItemsForm, setDocketItemsForm] = useState<
    Array<{ itemNameParty: string; uom: string; qty: string }>
  >([{ itemNameParty: '', uom: '', qty: '' }]);

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
    status: 'Quoted',
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

  // User Groq API Key state (saved in localStorage)
  const [userGroqApiKey, setUserGroqApiKey] = useState<string>('');
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [structuralErrorMessage, setStructuralErrorMessage] = useState<string>('');

  useEffect(() => {
    const savedKey = localStorage.getItem('groq_api_key');
    if (savedKey) {
      setUserGroqApiKey(savedKey);
    }
  }, []);

  const saveUserGroqApiKey = (key: string) => {
    setUserGroqApiKey(key);
    localStorage.setItem('groq_api_key', key.trim());
    showToast('Saved Groq API Key!');
  };

  const fetchStructuralOptionsForItem = async (item: Item) => {
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

    const storedApiKey = userGroqApiKey || (typeof window !== 'undefined' ? localStorage.getItem('groq_api_key') || '' : '');

    try {
      const res = await fetch('/api/ai/structural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          itemNameParty: item.itemNameParty,
          apiKey: storedApiKey,
        }),
      });

      const data = await res.json();
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
      console.error('Error fetching structural options for item:', err);
      setStructuralErrorMessage(err.message || 'Failed to connect to Groq AI API');
    } finally {
      setStructuralLoading(false);
    }
  };

  const handleApplyStructuralOption = async () => {
    const currentItem = structuralQueue[currentStructuralIndex];
    if (!currentItem) return;

    try {
      setStructuralLoading(true);
      await handleItemFieldUpdate(currentItem.id, 'sectionMm', customStructuralForm.sectionMm);
      await handleItemFieldUpdate(currentItem.id, 'sectionalWtKgMtr', customStructuralForm.sectionalWtKgMtr);
      await handleItemFieldUpdate(currentItem.id, 'lengthInMtr', customStructuralForm.lengthInMtr);
      await handleItemFieldUpdate(currentItem.id, 'unitWtOfMemberKg', customStructuralForm.unitWtOfMemberKg);

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

    try {
      const storedApiKey = userGroqApiKey || (typeof window !== 'undefined' ? localStorage.getItem('groq_api_key') || '' : '');
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNameParty,
          typeOfItem: typeOfItem || '',
          selectedCategory,
          apiKey: storedApiKey,
        }),
      });

      const data = await res.json();
      if (res.ok && data.reasoning) {
        setReasoningContent(data.reasoning);
        setReasoningUserNote(data.reasoning);
      } else {
        setReasoningContent(data.error || 'Categorized strictly based on raw item text specifications.');
        setReasoningUserNote(data.error || 'Categorized strictly based on raw item text specifications.');
      }
    } catch (err: any) {
      console.error(err);
      setReasoningContent('Factual categorization based on raw item text specifications.');
      setReasoningUserNote('Factual categorization based on raw item text specifications.');
    } finally {
      setReasoningLoading(false);
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
    setAiProcessing(true);
    setAiProgressText(
      targetDocketNo
        ? `AI Analyzing Manufacturing/Trading items for Docket ${targetDocketNo}...`
        : 'AI Analyzing & Categorizing Manufacturing/Trading items...'
    );

    try {
      const storedApiKey = userGroqApiKey || (typeof window !== 'undefined' ? localStorage.getItem('groq_api_key') || '' : '');
      const res = await fetch('/api/ai/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docketNoQtnNo: targetDocketNo || null,
          apiKey: storedApiKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI categorization failed');
      }

      if (data.updatedCount === 0) {
        showToast('AI Check Complete: No unclassified Manufacturing/Trading items found.');
      } else {
        showToast(`✨ AI Autofill Complete! Categorized ${data.updatedCount} items.`);
        // Refresh items table & docket map
        await fetchItems();
        await fetchDockets();
        if (targetDocketNo) {
          await fetchItemsForDocket(targetDocketNo, true);
        } else {
          // Force refresh all currently cached expanded dockets so item count is never 0
          Object.keys(docketItemsMap).forEach((dNo) => {
            fetchItemsForDocket(dNo, true);
          });
        }
      }

      // Collect candidate items for Structural Calculator (MANUFACTURING/TRADING items with blank sectionMm)
      let candidates: Item[] = [];
      if (targetDocketNo && docketItemsMap[targetDocketNo]) {
        candidates = docketItemsMap[targetDocketNo].filter(
          (it) =>
            (it.ourItemNot === 'MANUFACTURING' || it.ourItemNot === 'TRADING') &&
            (!it.sectionMm || it.sectionMm.trim() === '')
        );
      } else {
        candidates = items.filter(
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

  // Login authentication handler
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const matchedUser = AUTH_USERS.find(
      (u) =>
        u.username.toLowerCase() === loginUsername.trim().toLowerCase() &&
        u.password === loginPassword
    );

    if (matchedUser) {
      const userSession: UserRole = {
        username: matchedUser.username,
        name: matchedUser.name,
        id: matchedUser.id,
        role: matchedUser.role,
      };
      setCurrentUser(userSession);
      setIsAuthenticated(true);
      if (typeof window !== 'undefined') {
        localStorage.setItem('ceebuild_user', JSON.stringify(userSession));
      }
      showToast(`Welcome, ${matchedUser.name}! Logged in as ${matchedUser.role}.`);
      setLoginUsername('');
      setLoginPassword('');
    } else {
      setLoginError('Invalid Username or Password. Please try again.');
    }
  };

  // Logout handler
  const handleLogout = () => {
    setIsAuthenticated(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ceebuild_user');
    }
    showToast('Logged out successfully.');
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
      }
    } catch (err) {
      console.error(err);
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
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Edit value string for Master Value (Admin)
  const handleUpdateMasterValue = async (id: number, newValue: string) => {
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
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Master Value (Admin)
  const handleDeleteMasterValue = async (id: number) => {
    try {
      const res = await fetch(`/api/master-values?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setMasterList((prev) => prev.filter((m) => m.id !== id));
        fetchMasterValues();
        showToast(`Deleted master option #${id}`);
      }
    } catch (err) {
      console.error(err);
    }
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

  // Fetch Items
  const fetchItems = async () => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(itemPage));
      params.append('limit', String(itemLimit));
      if (search) params.append('search', search);
      if (itemFilters.docketNoQtnNo) params.append('docketNoQtnNo', itemFilters.docketNoQtnNo);
      if (itemFilters.itemNameParty) params.append('itemNameParty', itemFilters.itemNameParty);
      if (itemFilters.ourItemNot) params.append('ourItemNot', itemFilters.ourItemNot);
      if (itemFilters.ourItemName.length > 0) params.append('ourItemName', itemFilters.ourItemName.join(','));
      if (itemFilters.status) params.append('status', itemFilters.status);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const res = await fetch(`/api/items?${params.toString()}`);
      const data = await res.json();
      if (data.items) {
        setItems(data.items);
        setItemTotalCount(data.totalCount || data.items.length);
        setItemTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setItemsLoading(false);
    }
  };

  // Fetch Dockets
  const fetchDockets = async () => {
    setDocketsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(docketPage));
      params.append('limit', String(docketLimit));
      if (search) params.append('search', search);
      if (docketFilters.docketNoQtnNo) params.append('docketNoQtnNo', docketFilters.docketNoQtnNo);
      if (docketFilters.partyName) params.append('partyName', docketFilters.partyName);
      if (docketFilters.itemFilter) params.append('itemFilter', docketFilters.itemFilter);
      if (docketFilters.state) params.append('state', docketFilters.state);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const res = await fetch(`/api/dockets?${params.toString()}`);
      const data = await res.json();
      if (data.dockets) {
        setDockets(data.dockets);
        setDocketTotalCount(data.totalCount || data.dockets.length);
        setDocketTotalPages(data.totalPages || 1);
        if (data.states) setStateOptions(data.states);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDocketsLoading(false);
    }
  };

  // Fetch Items belonging to a specific docket number for sub-table accordion
  const fetchItemsForDocket = async (docketNo: string, forceRefresh: boolean = false) => {
    if (!docketNo || (!forceRefresh && docketItemsMap[docketNo] && docketItemsMap[docketNo].length > 0)) return;
    setLoadingDocketItems((prev) => ({ ...prev, [docketNo]: true }));
    try {
      const res = await fetch(`/api/items?docketNoQtnNo=${encodeURIComponent(docketNo.trim())}&limit=200`);
      const data = await res.json();
      if (data.items) {
        setDocketItemsMap((prev) => ({ ...prev, [docketNo]: data.items }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDocketItems((prev) => ({ ...prev, [docketNo]: false }));
    }
  };

  const toggleDocketExpand = (id: number, docketNo: string | null) => {
    if (expandedDocketIds.includes(id)) {
      setExpandedDocketIds((prev) => prev.filter((i) => i !== id));
    } else {
      setExpandedDocketIds((prev) => [...prev, id]);
      if (docketNo) {
        fetchItemsForDocket(docketNo);
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
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (logTableFilter) params.append('tableName', logTableFilter);
      if (search) params.append('search', search);

      const res = await fetch(`/api/logs?${params.toString()}`);
      const data = await res.json();
      if (data.logs) setLogs(data.logs);
    } catch (err) {
      console.error(err);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleTabSwitch = (tab: 'items' | 'dockets' | 'terms' | 'logs' | 'master') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.pushState(null, '', url.pathname + url.search);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ceebuild_user');
      if (saved) {
        try {
          const userObj = JSON.parse(saved);
          if (userObj && userObj.username) {
            setCurrentUser(userObj);
            setIsAuthenticated(true);
          }
        } catch (err) {
          console.error(err);
        }
      }

      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab') as any;
      if (tabParam && ['items', 'dockets', 'terms', 'logs', 'master'].includes(tabParam)) {
        setActiveTab(tabParam);
      }
    }
    setAuthLoading(false);

    // Fetch counts and master values for all tabs on mount
    fetchMasterValues();
    fetchNextDocketNo();
    fetchItems();
    fetchDockets();
    fetchTerms();
    fetchLogs();
  }, []);

  useEffect(() => {
    if (activeTab === 'items') fetchItems();
    else if (activeTab === 'dockets') fetchDockets();
    else if (activeTab === 'terms') fetchTerms();
    else if (activeTab === 'logs') fetchLogs();
    else if (activeTab === 'master') fetchMasterValues();
  }, [activeTab, search, startDate, endDate, itemFilters, docketFilters, logTableFilter, itemPage, itemLimit, docketPage, docketLimit]);

  // General field updater for ItemTable
  const handleItemFieldUpdate = async (id: number, field: keyof Item, value: string, docketNo?: string | null) => {
    const currentItem = items.find((i) => i.id === id);
    if (currentItem && currentItem[field] === value) return;

    try {
      const res = await fetch('/api/items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
      if (res.ok) {
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
        if (docketNo && docketItemsMap[docketNo]) {
          setDocketItemsMap((prev) => ({
            ...prev,
            [docketNo]: prev[docketNo].map((item) => (item.id === id ? { ...item, [field]: value } : item)),
          }));
        }
        showToast(`Item #${id} updated in DB by ${currentUser.name}`);
        if (activeTab === 'logs') fetchLogs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // General field updater for DockerPartyName
  const handleDocketFieldUpdate = async (id: number, field: keyof DockerParty, value: string) => {
    const currentDoc = dockets.find((d) => d.id === id);
    if (currentDoc && currentDoc[field] === value) return;

    try {
      const res = await fetch('/api/dockets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value, userName: currentUser.name, userId: currentUser.id }),
      });
      if (res.ok) {
        setDockets((prev) => prev.map((doc) => (doc.id === id ? { ...doc, [field]: value } : doc)));
        showToast(`Docket Party #${id} updated in DB by ${currentUser.name}`);
        if (activeTab === 'logs') fetchLogs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Docket & all associated items (Admin only)
  const handleDeleteDocket = async (id: number, docketNo: string | null) => {
    if (currentUser.role !== 'Admin') {
      showToast('Error: Only Admin users can delete dockets.');
      return;
    }

    const confirmMsg = `Are you sure you want to permanently delete Docket ${docketNo || '#' + id} and ALL of its associated items? This action cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

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
        showToast(`Docket ${docketNo || '#' + id} and all associated items permanently deleted.`);
        fetchItems(); // Refresh items table
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
  const handleDeleteItem = async (id: number, docketNo?: string | null) => {
    if (!window.confirm(`Are you sure you want to delete Item #${id}? This action cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/items?id=${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        setItemTotalCount((prev) => Math.max(0, prev - 1));
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
  const handleTermFieldUpdate = async (id: number, field: keyof TermCondition, value: string) => {
    const currentTerm = terms.find((t) => t.id === id);
    if (currentTerm && currentTerm[field] === value) return;

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
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Helper to parse TSV rows from Excel clipboard, handling quoted multiline cells
  const parseExcelClipboard = (text: string): Array<{ itemNameParty: string; uom: string; qty: string }> => {
    if (!text) return [];

    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === '\t' && !inQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }

    if (currentCell !== '' || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c !== '')) {
        rows.push(currentRow);
      }
    }

    return rows.map((cols) => {
      let itemName = cols[0] || '';
      let uom = cols[1] || '';
      let qty = cols[2] || '';

      if (cols.length === 1 && cols[0].includes('\t')) {
        const parts = cols[0].split('\t').map((p) => p.trim());
        itemName = parts[0] || '';
        uom = parts[1] || '';
        qty = parts[2] || '';
      }

      if (itemName.startsWith('"') && itemName.endsWith('"')) {
        itemName = itemName.slice(1, -1).trim();
      }
      itemName = itemName.replace(/^"+|"+$/g, '').trim();

      return {
        itemNameParty: itemName,
        uom: uom,
        qty: qty,
      };
    });
  };

  // Excel Bulk Copy-Paste Handler for item boxes in Add Docket Modal
  const handlePasteItems = (
    e: React.ClipboardEvent,
    rowIndex: number,
    targetField: 'itemNameParty' | 'uom' | 'qty'
  ) => {
    const pasteData = e.clipboardData.getData('text');
    if (!pasteData) return;

    const parsedItems = parseExcelClipboard(pasteData);
    if (parsedItems.length <= 1 && !pasteData.includes('\t') && !pasteData.includes('\n')) {
      return; // Normal single line paste
    }

    e.preventDefault();
    const newRows = [...docketItemsForm];

    parsedItems.forEach((parsed, idx) => {
      const targetIndex = rowIndex + idx;
      const rawName = parsed.itemNameParty || '';
      const autoNot = '';

      const itemObj = {
        itemNameParty: rawName,
        uom: parsed.uom || '',
        qty: parsed.qty || '',
        ourItemNot: autoNot,
      };

      if (targetIndex < newRows.length) {
        newRows[targetIndex] = {
          ...newRows[targetIndex],
          ...itemObj,
        };
      } else {
        newRows.push(itemObj);
      }
    });

    setDocketItemsForm(newRows);
    showToast(`Pasted & created ${parsedItems.length} item rows from Excel!`);
  };

  // Open Add Docket Modal and compute next incremental number
  const handleOpenAddDocketModal = () => {
    fetchNextDocketNo();
    setDocketItemsForm([{ itemNameParty: '', uom: '', qty: '' }]);
    setShowAddDocketModal(true);
  };

  // Create new Docket Party handler (Supports bulk items creation & user logging)
  const handleCreateDocket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const validItems = docketItemsForm.filter(
        (it) => it.itemNameParty && it.itemNameParty.trim() !== ''
      );

      const payload = {
        ...newDocketForm,
        items: validItems,
        userName: currentUser.name,
        userId: currentUser.id,
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
          price: '',
          payment: '',
          delivery: '',
          warranty: '',
          approval: '',
          inspection: '',
        });
        setDocketItemsForm([{ itemNameParty: '', uom: '', qty: '' }]);
        fetchDockets();
        fetchItems();
        fetchNextDocketNo();
        showToast(
          `Created Docket #${created.id} (${created.docketNoQtnNo}) with ${data.createdItemsCount || 0} items by ${currentUser.name}!`
        );
      }
    } catch (err) {
      console.error(err);
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
          status: 'Quoted',
        });
        fetchItems();
        if (targetDocketNo) {
          fetchItemsForDocket(targetDocketNo, true);
        }
        showToast(`Created Item #${created.id} under Docket ${targetDocketNo || 'N/A'}!`);
      }
    } catch (err) {
      console.error(err);
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
      }
    } catch (err) {
      console.error(err);
    }
  };

  const clearAllFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setItemFilters({ docketNoQtnNo: '', itemNameParty: '', ourItemNot: '', ourItemName: [], status: '' });
    setDocketFilters({ docketNoQtnNo: '', partyName: '', itemFilter: '', state: '' });
    setLogTableFilter('');
    setItemPage(1);
    setDocketPage(1);
  };

  // IF AUTH IS LOADING -> SHOW CLEAN SPINNER TO PREVENT FLASHING SIGN IN SCREEN
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 font-sans p-4">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold text-slate-300">Loading Dashboard...</span>
        </div>
      </div>
    );
  }

  // IF NOT AUTHENTICATED -> SHOW Sleek Professional Login Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 font-sans p-4 relative overflow-hidden">
        {/* Background Decorative Blur Orbs */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600/30 rounded-full blur-3xl" />

        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 space-y-6 relative z-10 animate-in fade-in zoom-in duration-200">
          <div className="text-center space-y-3">
            <div className="inline-flex p-3 bg-blue-50 rounded-2xl border border-blue-100 shadow-sm">
              <img src="/ceebuild-logo.png" alt="CEEBUILD Logo" className="h-12 w-auto object-contain" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">CEEBUILD Dashboard Login</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Enter your User ID and Password to access the dashboard
              </p>
            </div>
          </div>

          {loginError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs font-bold text-center">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs font-medium">
            <div>
              <label className="font-extrabold text-slate-700 block mb-1.5">User ID / Username:</label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder="admin or tanmoy"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-bold transition-all"
                />
              </div>
            </div>

            <div>
              <label className="font-extrabold text-slate-700 block mb-1.5">Password:</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-bold transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-3.5 rounded-xl transition-all shadow-md shadow-blue-500/20 text-xs flex items-center justify-center space-x-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Login to Dashboard</span>
            </button>
          </form>

          {/* <div className="pt-4 border-t border-slate-100 text-center text-[11px] text-slate-400">
            Authorized Users: <strong className="text-slate-600">admin / admin</strong> or{' '}
            <strong className="text-slate-600">tanmoy / tanmoy</strong>
          </div> */}
        </div>
      </div>
    );
  }

  const filteredMasterItems = masterList.filter(
    (m) => m.type === masterCategoryFilter && (search ? m.value.toLowerCase().includes(search.toLowerCase()) : true)
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 font-sans text-slate-900">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-sm font-semibold animate-bounce">
          <CheckCircle className="w-5 h-5 text-emerald-200" />
          <span>{notification}</span>
        </div>
      )}

      {/* AI Processing Overlay Modal & Animation */}
      {aiProcessing && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-blue-100 text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-blue-200 animate-ping opacity-40"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
              <div className="bg-blue-600 text-white p-3.5 rounded-2xl shadow-lg">
                <Sparkles className="w-8 h-8 animate-pulse" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 flex items-center justify-center gap-2">
                <span>AI Categorization Active</span>
                <span className="text-xs bg-blue-100 text-blue-800 font-extrabold px-2 py-0.5 rounded-full">Groq AI</span>
              </h3>
              <p className="text-xs text-slate-600 font-semibold mt-1">
                {aiProgressText || 'Analyzing raw item descriptions into standard categories...'}
              </p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 h-full w-full animate-pulse"></div>
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
          <div className="bg-white rounded-3xl border border-blue-200 shadow-2xl max-w-lg w-full p-6 space-y-5 relative">
            <button
              onClick={() => setReasoningModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-all"
              title="Close / Skip"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-2xl text-white shadow-md">
                <Brain className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  AI Categorization Reasoning
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Factual Context Explanation (No Speculation)
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
              <div>
                <span className="font-extrabold text-slate-700 uppercase tracking-wider text-[10px]">
                  Raw Item Description:
                </span>
                <p className="font-semibold text-slate-900 mt-0.5">{reasoningItemText}</p>
              </div>
              <div className="flex items-center space-x-4 pt-1">
                <div>
                  <span className="font-bold text-slate-500 text-[10px]">TYPE OF ITEM:</span>
                  <span className="ml-1 font-extrabold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                    {reasoningType}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 text-[10px]">ASSIGNED CATEGORY:</span>
                  <span className="ml-1 font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                    {reasoningCategory}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between text-blue-900 font-extrabold text-xs">
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
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition-all"
              >
                Skip / Close
              </button>
              <button
                onClick={handleSaveAiKnowledge}
                disabled={savingKnowledge || reasoningLoading}
                className="flex items-center space-x-1.5 px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition-all shadow-md"
              >
                {savingKnowledge ? (
                  <span>Saving Rule...</span>
                ) : (
                  <>
                    <Brain className="w-3.5 h-3.5 text-yellow-300" />
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
          <div className="bg-white rounded-3xl border border-indigo-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowStructuralModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-all"
              title="Close Flow"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-2.5 rounded-2xl text-white shadow-md">
                <Building className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span>AI Structural Member Selection</span>
                  <span className="text-xs bg-indigo-100 text-indigo-800 font-extrabold px-2 py-0.5 rounded-full">
                    BOM Item {currentStructuralIndex + 1} of {structuralQueue.length}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  IS 808 Indian Substation Structural Engineer Suggestions
                </p>
              </div>
            </div>

            {/* Current Item Raw Description */}
            <div className="bg-indigo-50/60 border border-indigo-200 rounded-2xl p-4 space-y-1">
              <span className="font-extrabold text-indigo-700 uppercase tracking-wider text-[10px]">
                Target Item Description:
              </span>
              <p className="font-bold text-slate-900 text-xs">
                #{structuralQueue[currentStructuralIndex]?.id} — {structuralQueue[currentStructuralIndex]?.itemNameParty}
              </p>
            </div>

            {/* AI Suggested Options List */}
            {structuralLoading ? (
              <div className="p-8 text-center space-y-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  Calculating IS 808 Sectional Weights & REC Cut Lengths for this item...
                </p>
              </div>
            ) : structuralOptions.length === 0 ? (
              <div className="p-5 bg-rose-50 border border-rose-200 rounded-2xl space-y-3 text-xs">
                <div className="flex items-center space-x-2 text-rose-800 font-bold">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  <span>
                    {structuralErrorMessage || 'Groq AI returned no structural section options.'}
                  </span>
                </div>
                <p className="text-slate-600 text-[11px]">
                  Please enter a valid <strong>Groq API Key</strong> below (from <code>console.groq.com</code>) to power AI structural calculations:
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="password"
                    placeholder="gsk_..."
                    value={userGroqApiKey}
                    onChange={(e) => setUserGroqApiKey(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    onClick={() => {
                      saveUserGroqApiKey(userGroqApiKey);
                      if (structuralQueue[currentStructuralIndex]) {
                        fetchStructuralOptionsForItem(structuralQueue[currentStructuralIndex]);
                      }
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all shrink-0"
                  >
                    Save & Retry AI
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="font-extrabold text-slate-700 text-xs block">
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
                        className={`cursor-pointer p-3.5 rounded-2xl border transition-all text-xs space-y-1.5 ${
                          isSelected
                            ? 'bg-indigo-50/90 border-indigo-600 shadow-md ring-2 ring-indigo-500/20'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-indigo-900 font-mono text-xs">
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
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <span className="font-extrabold text-slate-700 text-xs block">
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
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-extrabold text-xs rounded-xl transition-all"
              >
                Cancel Flow
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSkipStructuralOption}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold text-xs rounded-xl transition-all"
                >
                  Skip Item
                </button>
                <button
                  onClick={handleApplyStructuralOption}
                  disabled={structuralLoading}
                  className="flex items-center space-x-1.5 px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition-all shadow-md"
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

      {/* Header Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="w-full px-6 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-center">
              <img src="/ceebuild-logo.png" alt="CEEBUILD Logo" className="h-10 w-auto object-contain" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                Ceebuild Items & Docket Dashboard
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* LOGGED IN USER BADGE & SWITCH USER / LOGOUT */}
            <div className="flex items-center bg-slate-100 p-1.5 rounded-2xl border border-slate-200 space-x-2">
              <div className="flex items-center space-x-1.5 pl-2 text-xs font-bold text-slate-700">
                <UserCheck className="w-4 h-4 text-blue-600" />
                <span>
                  User: <strong className="text-slate-900">{currentUser.name}</strong> ({currentUser.id})
                </span>
                <span className="ml-1 text-[10px] bg-blue-100 text-blue-800 font-extrabold px-2 py-0.5 rounded-full">
                  {currentUser.role}
                </span>
              </div>

              <button
                onClick={handleLogout}
                className="flex items-center space-x-1 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 font-bold text-xs px-2.5 py-1 rounded-xl transition-all shadow-xs"
                title="Logout / Switch Account"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex flex-wrap items-center bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
              <button
                onClick={() => handleTabSwitch('items')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'items'
                    ? 'bg-white text-blue-600 shadow-md shadow-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>iteam-table</span>
                <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-extrabold">
                  {itemTotalCount}
                </span>
              </button>

              <button
                onClick={() => handleTabSwitch('dockets')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'dockets'
                    ? 'bg-white text-blue-600 shadow-md shadow-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Building className="w-4 h-4" />
                <span>Docket</span>
                <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full text-xs font-extrabold">
                  {docketTotalCount}
                </span>
              </button>

              <button
                onClick={() => handleTabSwitch('terms')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'terms'
                    ? 'bg-white text-blue-600 shadow-md shadow-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>tream-and-conditions</span>
                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-xs font-extrabold">
                  {terms.length}
                </span>
              </button>

              <button
                onClick={() => handleTabSwitch('logs')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'logs'
                    ? 'bg-white text-rose-600 shadow-md shadow-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <History className="w-4 h-4 text-rose-500" />
                <span>edit-logs (Audit)</span>
                <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full text-xs font-extrabold">
                  {logs.length}
                </span>
              </button>

              {/* ADMIN-ONLY MASTER DROPDOWNS CONTROL SECTION TAB */}
              {currentUser.role === 'Admin' && (
                <button
                  onClick={() => handleTabSwitch('master')}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    activeTab === 'master'
                      ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                      : 'text-amber-700 hover:text-amber-900 hover:bg-amber-100/60 font-extrabold'
                  }`}
                >
                  <Sliders className="w-4 h-4" />
                  <span>master-dropdowns (Admin)</span>
                  <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full text-xs font-extrabold">
                    {masterList.length}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="w-full px-6 py-6 flex-1 space-y-6">
        {/* Controls & Filter Bar */}
        {activeTab !== 'master' && (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Global Search */}
              <div className="relative flex-1 min-w-[280px]">
                <Search className="w-4.5 h-4.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search across all table fields..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setItemPage(1);
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
                <div className="flex items-center space-x-2 bg-slate-50 p-1 border border-slate-200 rounded-xl">
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

              {/* Reset Filters */}
              <button
                onClick={clearAllFilters}
                className="flex items-center space-x-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-xl transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            </div>

            {/* Items Sub-Filter Chips */}
            {activeTab === 'items' && (
              <div className="pt-2 border-t border-slate-100 flex items-center space-x-3 overflow-x-auto">
                <span className="text-xs font-bold text-slate-700 whitespace-nowrap flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-blue-600" />
                  Filter Item Name:
                </span>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {ourItemNameOptions.map((opt) => {
                    const isSelected = itemFilters.ourItemName.includes(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => {
                          setItemPage(1);
                          setItemFilters((prev) => {
                            const exists = prev.ourItemName.includes(opt);
                            const updated = exists
                              ? prev.ourItemName.filter((o) => o !== opt)
                              : [...prev.ourItemName, opt];
                            return { ...prev, ourItemName: updated };
                          });
                        }}
                        className={`text-[11px] px-2.5 py-1 rounded-lg border font-bold transition-all ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {opt} {isSelected && '✓'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 1: ITEAM-TABLE */}
        {activeTab === 'items' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden flex flex-col">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
              <div className="flex items-center space-x-3">
                <h2 className="text-sm font-bold text-slate-900">iteam-table Records</h2>
                <button
                  onClick={() => handleAiAutofill()}
                  disabled={aiProcessing}
                  className="flex items-center space-x-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-extrabold text-xs px-3.5 py-1.5 rounded-xl shadow-md transition-all animate-in fade-in"
                  title="Automatically categorize MANUFACTURING/TRADING items using Groq AI"
                >
                  <Sparkles className="w-3.5 h-3.5 text-yellow-300 animate-pulse" />
                  <span>Autofill by AI</span>
                </button>
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-1.5 text-xs text-slate-600 font-medium">
                  <span>Rows per page:</span>
                  <select
                    value={itemLimit}
                    onChange={(e) => {
                      setItemLimit(Number(e.target.value));
                      setItemPage(1);
                    }}
                    className="bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-bold text-slate-800"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>

                <span className="text-xs font-bold text-slate-700">
                  Page {itemPage} of {itemTotalPages} ({itemTotalCount} Total Items)
                </span>

                <div className="flex items-center space-x-1">
                  <button
                    disabled={itemPage <= 1}
                    onClick={() => setItemPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-slate-700 font-bold transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled={itemPage >= itemTotalPages}
                    onClick={() => setItemPage((p) => Math.min(itemTotalPages, p + 1))}
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-slate-700 font-bold transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[680px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 text-slate-800 font-extrabold sticky top-0 z-30 border-b border-slate-200 text-[11px] uppercase tracking-wider">
                  <tr>
                    {/* Sticky Column 1: ID (width 80px) */}
                    <th className="p-3 whitespace-nowrap w-[80px] min-w-[80px] sticky left-0 z-40 bg-slate-100 border-r border-slate-300 shadow-xs">
                      ID
                    </th>
                    {/* Sticky Column 2: Docket / Qtn No (width 170px, offset left 80px) */}
                    <th className="p-3 whitespace-nowrap w-[170px] min-w-[170px] sticky left-[80px] z-40 bg-slate-100 border-r border-slate-300 shadow-xs">
                      DOCKET / QTN NO
                    </th>

                    <th className="p-3 whitespace-nowrap min-w-[280px]">ITEM NAME- PARTY</th>
                    <th className="p-3 whitespace-nowrap min-w-[90px]">UOM</th>
                    <th className="p-3 whitespace-nowrap min-w-[90px]">QTY</th>
                    <th className="p-3 whitespace-nowrap bg-blue-50/80 min-w-[180px]">OUR ITEM/NOT</th>
                    <th className="p-3 whitespace-nowrap min-w-[160px]">TYPE OF ITEM</th>
                    <th className="p-3 whitespace-nowrap bg-blue-50/80 min-w-[220px]">Our item Name</th>
                    <th className="p-3 whitespace-nowrap min-w-[140px]">SIZE</th>
                    <th className="p-3 whitespace-nowrap min-w-[140px]">Section (mm)</th>
                    <th className="p-3 whitespace-nowrap min-w-[160px]">Sectional Wt. (Kg/Mtr.)</th>
                    <th className="p-3 whitespace-nowrap min-w-[130px]">Length (Mtr.)</th>
                    <th className="p-3 whitespace-nowrap min-w-[180px]">Unit Wt. of Member (Kg)</th>
                    <th className="p-3 whitespace-nowrap min-w-[140px]">Weight Per Pc</th>
                    <th className="p-3 whitespace-nowrap min-w-[120px]">Price</th>
                    <th className="p-3 whitespace-nowrap bg-blue-50/80 min-w-[160px]">Status</th>
                    <th className="p-3 whitespace-nowrap text-center min-w-[80px]">Action</th>
                  </tr>

                  {/* Filter Header Row */}
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td className="p-2 w-[80px] min-w-[80px] sticky left-0 z-30 bg-slate-100 border-r border-slate-300 shadow-xs text-center font-bold text-slate-400 text-[10px]">
                      ID
                    </td>
                    <td className="p-2 w-[170px] min-w-[170px] sticky left-[80px] z-30 bg-slate-100 border-r border-slate-300 shadow-xs">
                      <input
                        type="text"
                        placeholder="Filter Docket..."
                        value={itemFilters.docketNoQtnNo}
                        onChange={(e) => {
                          setItemFilters((prev) => ({ ...prev, docketNoQtnNo: e.target.value }));
                          setItemPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-2 min-w-[280px]">
                      <input
                        type="text"
                        placeholder="Filter Item..."
                        value={itemFilters.itemNameParty}
                        onChange={(e) => {
                          setItemFilters((prev) => ({ ...prev, itemNameParty: e.target.value }));
                          setItemPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-2 min-w-[90px]"></td>
                    <td className="p-2 min-w-[90px]"></td>
                    <td className="p-2 min-w-[180px]">
                      <select
                        value={itemFilters.ourItemNot}
                        onChange={(e) => {
                          setItemFilters((prev) => ({ ...prev, ourItemNot: e.target.value }));
                          setItemPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">All</option>
                        <option value="MANUFACTURING">MANUFACTURING</option>
                        <option value="NO">NO</option>
                        <option value="TRADING">TRADING</option>
                      </select>
                    </td>
                    <td className="p-2 min-w-[160px]"></td>
                    <td className="p-2 min-w-[220px]"></td>
                    <td className="p-2 min-w-[140px]"></td>
                    <td className="p-2 min-w-[140px]"></td>
                    <td className="p-2 min-w-[160px]"></td>
                    <td className="p-2 min-w-[130px]"></td>
                    <td className="p-2 min-w-[180px]"></td>
                    <td className="p-2 min-w-[140px]"></td>
                    <td className="p-2 min-w-[120px]"></td>
                    <td className="p-2 min-w-[160px]">
                      <select
                        value={itemFilters.status}
                        onChange={(e) => {
                          setItemFilters((prev) => ({ ...prev, status: e.target.value }));
                          setItemPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">All Statuses</option>
                        {masterSuggestions.STATUS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 min-w-[80px]"></td>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {itemsLoading ? (
                    <tr>
                      <td colSpan={17} className="p-8 text-center text-slate-500 font-medium">
                        Loading items...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={17} className="p-8 text-center text-slate-500 font-medium">
                        No items found matching your filters.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors align-top min-h-[44px]">
                        {/* Sticky Body Cell 1: ID */}
                        <td className="p-3 text-slate-500 font-mono text-xs font-bold w-[80px] min-w-[80px] sticky left-0 z-20 bg-white group-hover:bg-slate-50 border-r border-slate-300 shadow-xs">
                          #{item.id}
                        </td>

                        {/* Sticky Body Cell 2: Docket No */}
                        <td className="p-3 w-[170px] min-w-[170px] sticky left-[80px] z-20 bg-white group-hover:bg-slate-50 border-r border-slate-300 shadow-xs font-bold text-blue-600">
                          {currentUser.role === 'Admin' ? (
                            <AutoResizeTextarea
                              defaultValue={item.docketNoQtnNo || ''}
                              onSave={(val) => handleItemFieldUpdate(item.id, 'docketNoQtnNo', val)}
                              className="font-bold text-blue-600"
                            />
                          ) : (
                            <span className="font-bold text-blue-600 px-2 py-1 block text-xs">
                              {item.docketNoQtnNo || '-'}
                            </span>
                          )}
                        </td>

                        <td className="p-3 min-w-[280px]">
                          <AutoResizeTextarea
                            defaultValue={item.itemNameParty || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'itemNameParty', val)}
                            placeholder="Enter item name..."
                          />
                        </td>

                        <td className="p-3 min-w-[90px]">
                          <input
                            type="text"
                            defaultValue={item.uom || ''}
                            onBlur={(e) => handleItemFieldUpdate(item.id, 'uom', e.target.value)}
                            className="w-20 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none"
                          />
                        </td>

                        <td className="p-3 min-w-[90px]">
                          <input
                            type="text"
                            defaultValue={item.qty || ''}
                            onBlur={(e) => handleItemFieldUpdate(item.id, 'qty', e.target.value)}
                            className="w-20 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
                          />
                        </td>

                        <td className="p-3 bg-blue-50/20 min-w-[180px]">
                          <select
                            value={item.ourItemNot || ''}
                            onChange={(e) => handleItemFieldUpdate(item.id, 'ourItemNot', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-md px-2 py-1.5 text-xs font-extrabold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          >
                            <option value="">Select</option>
                            <option value="MANUFACTURING">MANUFACTURING</option>
                            <option value="NO">NO</option>
                            <option value="TRADING">TRADING</option>
                          </select>
                        </td>

                        <td className="p-3 min-w-[160px]">
                          <AutoResizeTextarea
                            defaultValue={item.typeOfItem || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'typeOfItem', val)}
                          />
                        </td>

                        <td className="p-3 bg-blue-50/20 min-w-[240px]">
                          <div className="flex items-center space-x-1.5">
                            <select
                              value={item.ourItemName || ''}
                              onChange={(e) => {
                                handleItemFieldUpdate(item.id, 'ourItemName', e.target.value);
                                if (e.target.value === 'OTHERS') {
                                  openReasoningModal(item.itemNameParty, item.typeOfItem, e.target.value);
                                }
                              }}
                              className="w-full bg-white border border-slate-300 rounded-md px-2 py-1.5 text-xs font-extrabold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            >
                              <option value="">Select Item Name</option>
                              {ourItemNameOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>

                            {item.ourItemName && (
                              <button
                                onClick={() => openReasoningModal(item.itemNameParty, item.typeOfItem, item.ourItemName)}
                                className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-all border border-blue-200 shrink-0"
                                title="View AI Factual Reasoning & Explanation for this Category"
                              >
                                <Brain className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="p-3 min-w-[140px]">
                          <AutoResizeTextarea
                            defaultValue={item.size || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'size', val)}
                          />
                        </td>

                        <td className="p-3 min-w-[140px]">
                          <AutoResizeTextarea
                            defaultValue={item.sectionMm || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'sectionMm', val)}
                            placeholder="e.g. 125x65x6mm"
                          />
                        </td>

                        <td className="p-3 min-w-[160px]">
                          <AutoResizeTextarea
                            defaultValue={item.sectionalWtKgMtr || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'sectionalWtKgMtr', val)}
                            placeholder="Kg/Mtr."
                          />
                        </td>

                        <td className="p-3 min-w-[130px]">
                          <AutoResizeTextarea
                            defaultValue={item.lengthInMtr || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'lengthInMtr', val)}
                            placeholder="Mtr."
                          />
                        </td>

                        <td className="p-3 min-w-[180px]">
                          <AutoResizeTextarea
                            defaultValue={item.unitWtOfMemberKg || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'unitWtOfMemberKg', val)}
                            placeholder="Kg"
                          />
                        </td>

                        <td className="p-3 min-w-[140px]">
                          <AutoResizeTextarea
                            defaultValue={item.weightPerPiece || ''}
                            onSave={(val) => handleItemFieldUpdate(item.id, 'weightPerPiece', val)}
                          />
                        </td>

                        <td className="p-3 min-w-[120px]">
                          <input
                            type="text"
                            defaultValue={item.price || ''}
                            onBlur={(e) => handleItemFieldUpdate(item.id, 'price', e.target.value)}
                            className="w-24 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 text-xs font-extrabold text-slate-900 focus:outline-none"
                          />
                        </td>

                        <td className="p-3 bg-blue-50/20 min-w-[160px]">
                          <select
                            value={item.status || ''}
                            onChange={(e) => handleItemFieldUpdate(item.id, 'status', e.target.value)}
                            className={`w-full border rounded-md px-2 py-1.5 text-xs font-extrabold focus:outline-none ${
                              item.status === 'Quoted'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : item.status === 'NOT Required'
                                ? 'bg-rose-50 text-rose-800 border-rose-300'
                                : 'bg-white border-slate-300'
                            }`}
                          >
                            <option value="">Select Status</option>
                            {masterSuggestions.STATUS.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="p-3 text-center min-w-[80px]">
                          <button
                            onClick={() => handleDeleteItem(item.id, item.docketNoQtnNo)}
                            className="p-1.5 bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white rounded-lg border border-rose-200 hover:border-rose-600 transition-all shadow-xs"
                            title="Delete this Item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

        {/* TAB 2: docket-party-name (WITH ACCORDION ARROW & ADD DOCKET/ITEM BUTTONS) */}
        {activeTab === 'dockets' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden flex flex-col space-y-3">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">docket-party-name Records</h2>
                <p className="text-[11px] text-slate-500 font-medium">
                  Click the arrow on any docket row to expand & view/manage all belonging items.
                </p>
              </div>

              <div className="flex items-center space-x-4">
                {/* Add Docket Button */}
                <button
                  onClick={handleOpenAddDocketModal}
                  className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm shadow-blue-500/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Docket</span>
                </button>

                {/* Pagination Controls */}
                <div className="flex items-center space-x-1.5 text-xs text-slate-600 font-medium border-l border-slate-200 pl-4">
                  <span>Rows:</span>
                  <select
                    value={docketLimit}
                    onChange={(e) => {
                      setDocketLimit(Number(e.target.value));
                      setDocketPage(1);
                    }}
                    className="bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-bold text-slate-800"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>

                <span className="text-xs font-bold text-slate-700">
                  Page {docketPage} of {docketTotalPages} ({docketTotalCount} Party Records)
                </span>

                <div className="flex items-center space-x-1">
                  <button
                    disabled={docketPage <= 1}
                    onClick={() => setDocketPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-slate-700 font-bold transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled={docketPage >= docketTotalPages}
                    onClick={() => setDocketPage((p) => Math.min(docketTotalPages, p + 1))}
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-slate-700 font-bold transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Item Filter Chips for Dockets */}
            <div className="px-4 py-2 bg-slate-50/60 border-b border-slate-200 flex items-center space-x-3 overflow-x-auto">
              <span className="text-xs font-bold text-slate-700 whitespace-nowrap flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-blue-600" />
                Filter Dockets by Item Name:
              </span>
              <div className="flex flex-wrap gap-1.5 items-center">
                {ourItemNameOptions.map((opt) => {
                  const isSelected = docketFilters.itemFilter === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => {
                        setDocketPage(1);
                        setDocketFilters((prev) => ({
                          ...prev,
                          itemFilter: isSelected ? '' : opt,
                        }));
                      }}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border font-bold transition-all ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {opt} {isSelected && '✓'}
                    </button>
                  );
                })}
                {docketFilters.itemFilter && (
                  <button
                    onClick={() => {
                      setDocketFilters((prev) => ({ ...prev, itemFilter: '' }));
                      setDocketPage(1);
                    }}
                    className="text-[11px] text-rose-600 font-bold px-2 py-1 hover:underline"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[680px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 text-slate-800 font-extrabold sticky top-0 z-30 border-b border-slate-200 text-[11px] uppercase tracking-wider">
                  <tr>
                    {/* STICKY COLUMN 1: ACTIONS PDF/AI/DELETE (width 230px) */}
                    <th className="p-3 whitespace-nowrap bg-blue-600 text-white font-extrabold text-center w-[230px] min-w-[230px] sticky left-0 z-40 shadow-xs">
                      ACTIONS (PDF / AI / DEL)
                    </th>
                    {/* STICKY COLUMN 2: ID (width 70px, offset left 230px) */}
                    <th className="p-3 whitespace-nowrap w-[70px] min-w-[70px] sticky left-[230px] z-40 bg-slate-100 border-r border-slate-300 shadow-xs">
                      ID
                    </th>

                    <th className="p-3 whitespace-nowrap min-w-[200px]">DOCKET / QTN NO</th>
                    <th className="p-3 whitespace-nowrap bg-blue-50/80 text-blue-900 font-extrabold min-w-[260px]">
                      FIRST ITEM NAME
                    </th>
                    <th className="p-3 whitespace-nowrap min-w-[240px]">PARTY NAME</th>
                    <th className="p-3 whitespace-nowrap min-w-[140px]">STATE</th>
                    <th className="p-3 whitespace-nowrap min-w-[120px]">UTILITY</th>
                    <th className="p-3 whitespace-nowrap min-w-[200px]">DELIVERY LOCATION</th>
                    <th className="p-3 whitespace-nowrap bg-purple-50 min-w-[220px]">Price Condition</th>
                    <th className="p-3 whitespace-nowrap bg-purple-50 min-w-[220px]">Payment Condition</th>
                    <th className="p-3 whitespace-nowrap bg-purple-50 min-w-[220px]">Delivery Condition</th>
                    <th className="p-3 whitespace-nowrap bg-purple-50 min-w-[220px]">Warranty Condition</th>
                    <th className="p-3 whitespace-nowrap bg-purple-50 min-w-[220px]">Approval Condition</th>
                    <th className="p-3 whitespace-nowrap bg-purple-50 min-w-[220px]">Inspection Condition</th>
                  </tr>

                  {/* Filter Header Row */}
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td className="p-2 w-[230px] min-w-[230px] text-center text-[10px] font-bold text-slate-400 sticky left-0 z-30 bg-slate-100 border-r border-slate-300 shadow-xs">
                      PDF / AI / Delete Actions
                    </td>
                    <td className="p-2 w-[70px] min-w-[70px] text-center text-[10px] font-bold text-slate-400 sticky left-[230px] z-30 bg-slate-100 border-r border-slate-300 shadow-xs">
                      ID
                    </td>

                    <td className="p-2 min-w-[200px]">
                      <input
                        type="text"
                        placeholder="Filter Docket..."
                        value={docketFilters.docketNoQtnNo}
                        onChange={(e) => {
                          setDocketFilters((prev) => ({ ...prev, docketNoQtnNo: e.target.value }));
                          setDocketPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-2 min-w-[260px] bg-blue-50/50">
                      <input
                        type="text"
                        placeholder="Filter Item Name..."
                        value={docketFilters.itemFilter}
                        onChange={(e) => {
                          setDocketFilters((prev) => ({ ...prev, itemFilter: e.target.value }));
                          setDocketPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-blue-300 rounded-md bg-white font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-2 min-w-[240px]">
                      <input
                        type="text"
                        placeholder="Filter Party..."
                        value={docketFilters.partyName}
                        onChange={(e) => {
                          setDocketFilters((prev) => ({ ...prev, partyName: e.target.value }));
                          setDocketPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-2 min-w-[140px]">
                      <select
                        value={docketFilters.state}
                        onChange={(e) => {
                          setDocketFilters((prev) => ({ ...prev, state: e.target.value }));
                          setDocketPage(1);
                        }}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">All States</option>
                        {stateOptions.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 min-w-[120px]"></td>
                    <td className="p-2 min-w-[200px]"></td>
                    <td className="p-2 min-w-[220px]"></td>
                    <td className="p-2 min-w-[220px]"></td>
                    <td className="p-2 min-w-[220px]"></td>
                    <td className="p-2 min-w-[220px]"></td>
                    <td className="p-2 min-w-[220px]"></td>
                    <td className="p-2 min-w-[220px]"></td>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 font-medium">
                  {docketsLoading ? (
                    <tr>
                      <td colSpan={14} className="p-10 text-center text-slate-400 font-semibold">
                        Loading docket party records...
                      </td>
                    </tr>
                  ) : dockets.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="p-10 text-center text-slate-400 font-semibold">
                        No docket party records found matching filters.
                      </td>
                    </tr>
                  ) : (
                    dockets.map((doc) => {
                      const isExpanded = expandedDocketIds.includes(doc.id);
                      const rawDocketItems = doc.docketNoQtnNo ? docketItemsMap[doc.docketNoQtnNo] || [] : [];
                      const isItemLoading = doc.docketNoQtnNo ? loadingDocketItems[doc.docketNoQtnNo] : false;

                      const activeFilterQuery = (docketFilters.itemFilter || search || '').trim().toLowerCase();
                      const docketItems = activeFilterQuery
                        ? rawDocketItems.filter((item) => {
                            const name = (item.itemNameParty || '').toLowerCase();
                            const ourName = (item.ourItemName || '').toLowerCase();
                            const type = (item.typeOfItem || '').toLowerCase();
                            return name.includes(activeFilterQuery) || ourName.includes(activeFilterQuery) || type.includes(activeFilterQuery);
                          })
                        : rawDocketItems;

                      return (
                        <React.Fragment key={doc.id}>
                          <tr className="group hover:bg-slate-50/90 transition-colors align-top min-h-[44px]">
                            {/* STICKY BODY CELL 1: GENERATE PDF, AI AUTOFILL & ADMIN DELETE BUTTONS */}
                            <td className="p-2 text-center w-[230px] min-w-[230px] sticky left-0 z-20 bg-white group-hover:bg-slate-50 border-r border-slate-300 shadow-xs">
                              <div className="flex items-center justify-center space-x-1">
                                <Link
                                  href={`/quotation/${doc.id}`}
                                  target="_blank"
                                  className="inline-flex items-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] px-2 py-1 rounded-xl transition-all shadow-xs"
                                  title="Generate PDF Quotation"
                                >
                                  <FileText className="w-3 h-3" />
                                  <span>PDF</span>
                                  <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                                </Link>

                                <button
                                  onClick={() => handleAiAutofill(doc.docketNoQtnNo || undefined)}
                                  disabled={aiProcessing}
                                  className="inline-flex items-center space-x-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-extrabold text-[11px] px-2 py-1 rounded-xl shadow-xs transition-all"
                                  title="Autofill unclassified items for this docket using Groq AI"
                                >
                                  <Sparkles className="w-3 h-3 text-yellow-300 animate-pulse" />
                                  <span>AI</span>
                                </button>

                                {currentUser.role === 'Admin' && (
                                  <button
                                    onClick={() => handleDeleteDocket(doc.id, doc.docketNoQtnNo)}
                                    className="inline-flex items-center justify-center p-1.5 bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-200 hover:border-rose-600 rounded-xl transition-all shadow-xs"
                                    title="Delete Docket & All Associated Items (Admin Only)"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* STICKY BODY CELL 2: ID */}
                            <td className="p-3 text-slate-500 font-mono text-xs font-bold w-[70px] min-w-[70px] sticky left-[230px] z-20 bg-white group-hover:bg-slate-50 border-r border-slate-300 shadow-xs">
                              #{doc.id}
                            </td>

                            {/* DOCKET NO WITH ARROW BUTTON TOGGLE */}
                            <td className="p-3 min-w-[200px]">
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => toggleDocketExpand(doc.id, doc.docketNoQtnNo)}
                                  className={`p-1.5 rounded-lg border transition-all ${
                                    isExpanded
                                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                      : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                  }`}
                                  title={isExpanded ? 'Collapse Items' : 'Expand & View Items'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                                <div className="flex-1">
                                  {currentUser.role === 'Admin' ? (
                                    <AutoResizeTextarea
                                      defaultValue={doc.docketNoQtnNo || ''}
                                      onSave={(val) => handleDocketFieldUpdate(doc.id, 'docketNoQtnNo', val)}
                                      className="font-bold text-blue-600"
                                    />
                                  ) : (
                                    <span className="font-bold text-blue-600 px-2 py-1 block text-xs">
                                      {doc.docketNoQtnNo || '-'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* FIRST ITEM NAME PREVIEW CELL */}
                            <td className="p-3 min-w-[260px] bg-blue-50/20">
                              {doc.firstItemName ? (
                                <div
                                  className="inline-flex items-center space-x-1.5 bg-white border border-blue-200 text-blue-900 rounded-lg px-2.5 py-1 text-xs font-bold shadow-2xs max-w-[250px] truncate"
                                  title={doc.firstItemName}
                                >
                                  <Package className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                  <span className="truncate">{doc.firstItemName}</span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">No items listed</span>
                              )}
                            </td>

                            <td className="p-3 min-w-[240px]">
                              <AutoResizeTextarea
                                defaultValue={doc.partyName || ''}
                                onSave={(val) => handleDocketFieldUpdate(doc.id, 'partyName', val)}
                                placeholder="Party Name..."
                                className="font-bold text-slate-900"
                              />
                            </td>

                            <td className="p-3 min-w-[140px]">
                              <AutoResizeTextarea
                                defaultValue={doc.state || ''}
                                onSave={(val) => handleDocketFieldUpdate(doc.id, 'state', val)}
                              />
                            </td>

                            <td className="p-3 min-w-[120px]">
                              <AutoResizeTextarea
                                defaultValue={doc.utility || ''}
                                onSave={(val) => handleDocketFieldUpdate(doc.id, 'utility', val)}
                              />
                            </td>

                            <td className="p-3 min-w-[200px]">
                              <AutoResizeTextarea
                                defaultValue={doc.deliveryLocation || ''}
                                onSave={(val) => handleDocketFieldUpdate(doc.id, 'deliveryLocation', val)}
                              />
                            </td>

                            {/* Terms Condition Dropdowns */}
                            <td className="p-3 bg-purple-50/30 min-w-[220px]">
                              <select
                                value={doc.price || ''}
                                onChange={(e) => handleDocketFieldUpdate(doc.id, 'price', e.target.value)}
                                className="w-full bg-white border border-purple-200 rounded-md px-2 py-1.5 text-xs font-semibold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                              >
                                <option value="">Select Price Condition</option>
                                {termsDropdowns.price.map((opt, i) => (
                                  <option key={i} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-3 bg-purple-50/30 min-w-[220px]">
                              <select
                                value={doc.payment || ''}
                                onChange={(e) => handleDocketFieldUpdate(doc.id, 'payment', e.target.value)}
                                className="w-full bg-white border border-purple-200 rounded-md px-2 py-1.5 text-xs font-semibold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                              >
                                <option value="">Select Payment Condition</option>
                                {termsDropdowns.payment.map((opt, i) => (
                                  <option key={i} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-3 bg-purple-50/30 min-w-[220px]">
                              <select
                                value={doc.delivery || ''}
                                onChange={(e) => handleDocketFieldUpdate(doc.id, 'delivery', e.target.value)}
                                className="w-full bg-white border border-purple-200 rounded-md px-2 py-1.5 text-xs font-semibold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                              >
                                <option value="">Select Delivery Condition</option>
                                {termsDropdowns.delivery.map((opt, i) => (
                                  <option key={i} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-3 bg-purple-50/30 min-w-[220px]">
                              <select
                                value={doc.warranty || ''}
                                onChange={(e) => handleDocketFieldUpdate(doc.id, 'warranty', e.target.value)}
                                className="w-full bg-white border border-purple-200 rounded-md px-2 py-1.5 text-xs font-semibold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                              >
                                <option value="">Select Warranty Condition</option>
                                {termsDropdowns.warranty.map((opt, i) => (
                                  <option key={i} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-3 bg-purple-50/30 min-w-[220px]">
                              <select
                                value={doc.approval || ''}
                                onChange={(e) => handleDocketFieldUpdate(doc.id, 'approval', e.target.value)}
                                className="w-full bg-white border border-purple-200 rounded-md px-2 py-1.5 text-xs font-semibold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                              >
                                <option value="">Select Approval Condition</option>
                                {termsDropdowns.approval.map((opt, i) => (
                                  <option key={i} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-3 bg-purple-50/30 min-w-[220px]">
                              <select
                                value={doc.inspection || ''}
                                onChange={(e) => handleDocketFieldUpdate(doc.id, 'inspection', e.target.value)}
                                className="w-full bg-white border border-purple-200 rounded-md px-2 py-1.5 text-xs font-semibold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                              >
                                <option value="">Select Inspection Condition</option>
                                {termsDropdowns.inspection.map((opt, i) => (
                                  <option key={i} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>

                          {/* EXPANDED ACCORDION SUB-TABLE FOR DOCKET ITEMS */}
                          {isExpanded && (
                            <tr className="bg-blue-50/40 border-b-2 border-blue-200">
                              <td colSpan={14} className="p-4 sm:p-6">
                                <div className="bg-white rounded-2xl border border-blue-200 shadow-md p-4 space-y-4">
                                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                                    <div className="flex items-center space-x-2">
                                      <div className="bg-blue-600 text-white p-2 rounded-xl">
                                        <Package className="w-4 h-4" />
                                      </div>
                                      <div>
                                        <h4 className="text-sm font-extrabold text-blue-900">
                                          Items belonging to Docket: {doc.docketNoQtnNo || 'CEE-000000'}
                                        </h4>
                                        <p className="text-xs text-slate-500">
                                          Party: <strong className="text-slate-800">{doc.partyName}</strong>
                                        </p>
                                      </div>
                                      <span className="bg-blue-100 text-blue-800 font-extrabold px-3 py-1 rounded-full text-xs ml-2">
                                        {docketItems.length} {activeFilterQuery ? `Filtered Items (of ${rawDocketItems.length} Total)` : 'Items Listed'}
                                      </span>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                      <button
                                        onClick={() => handleAiAutofill(doc.docketNoQtnNo || undefined)}
                                        disabled={aiProcessing}
                                        className="flex items-center space-x-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm"
                                        title="Autofill items for this docket using Groq AI"
                                      >
                                        <Sparkles className="w-3.5 h-3.5 text-yellow-300 animate-pulse" />
                                        <span>Autofill by AI</span>
                                      </button>

                                      {/* Add Item to Docket Button */}
                                      <button
                                        onClick={() => {
                                          setNewItemForm((prev) => ({
                                            ...prev,
                                            docketNoQtnNo: doc.docketNoQtnNo || '',
                                          }));
                                          setShowAddItemModal(true);
                                        }}
                                        className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm"
                                      >
                                        <Plus className="w-4 h-4" />
                                        <span>Create Item inside Docket</span>
                                      </button>

                                      {/* Delete Docket Button (Admin Only) */}
                                      {currentUser.role === 'Admin' && (
                                        <button
                                          onClick={() => handleDeleteDocket(doc.id, doc.docketNoQtnNo)}
                                          className="flex items-center space-x-1.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm"
                                          title="Delete Docket & All Associated Items"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                          <span>Delete Docket</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Sub-table items list */}
                                  {isItemLoading ? (
                                    <div className="p-6 text-center text-slate-500 font-medium">
                                      Loading items for docket {doc.docketNoQtnNo}...
                                    </div>
                                  ) : docketItems.length === 0 ? (
                                    <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">
                                      <p className="text-xs font-bold text-slate-600">
                                        No items currently added under docket {doc.docketNoQtnNo || 'N/A'}.
                                      </p>
                                      <button
                                        onClick={() => {
                                          setNewItemForm((prev) => ({
                                            ...prev,
                                            docketNoQtnNo: doc.docketNoQtnNo || '',
                                          }));
                                          setShowAddItemModal(true);
                                        }}
                                        className="mt-2 inline-flex items-center space-x-1 text-xs font-extrabold text-blue-600 hover:underline"
                                      >
                                        <Plus className="w-3.5 h-3.5" />
                                        <span>Add First Item</span>
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-left border-collapse text-xs border border-slate-200 rounded-lg">
                                        <thead className="bg-slate-100 text-slate-800 font-bold uppercase text-[10px]">
                                          <tr>
                                            <th className="p-2.5 border-b border-slate-200">Item ID</th>
                                            <th className="p-2.5 border-b border-slate-200 min-w-[220px]">ITEM NAME- PARTY</th>
                                            <th className="p-2.5 border-b border-slate-200">UOM</th>
                                            <th className="p-2.5 border-b border-slate-200">QTY</th>
                                            <th className="p-2.5 border-b border-slate-200">OUR ITEM/NOT</th>
                                            <th className="p-2.5 border-b border-slate-200 min-w-[180px]">Our item Name</th>
                                            <th className="p-2.5 border-b border-slate-200">SIZE</th>
                                            <th className="p-2.5 border-b border-slate-200">Section (mm)</th>
                                            <th className="p-2.5 border-b border-slate-200">Sectional Wt. (Kg/Mtr.)</th>
                                            <th className="p-2.5 border-b border-slate-200">Length (Mtr.)</th>
                                            <th className="p-2.5 border-b border-slate-200">Unit Wt. of Member (Kg)</th>
                                            <th className="p-2.5 border-b border-slate-200">PRICE</th>
                                            <th className="p-2.5 border-b border-slate-200">STATUS</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 font-medium">
                                          {docketItems.map((subItem) => (
                                            <tr key={subItem.id} className="hover:bg-slate-50">
                                              <td className="p-2.5 font-mono text-slate-500 font-bold">#{subItem.id}</td>
                                              <td className="p-2.5">
                                                <AutoResizeTextarea
                                                  defaultValue={subItem.itemNameParty || ''}
                                                  onSave={(val) =>
                                                    handleItemFieldUpdate(subItem.id, 'itemNameParty', val, doc.docketNoQtnNo)
                                                  }
                                                />
                                              </td>
                                              <td className="p-2.5">
                                                <input
                                                  type="text"
                                                  defaultValue={subItem.uom || ''}
                                                  onBlur={(e) =>
                                                    handleItemFieldUpdate(subItem.id, 'uom', e.target.value, doc.docketNoQtnNo)
                                                  }
                                                  className="w-16 p-1 border border-slate-200 rounded text-xs"
                                                />
                                              </td>
                                              <td className="p-2.5 font-bold">
                                                <input
                                                  type="text"
                                                  defaultValue={subItem.qty || ''}
                                                  onBlur={(e) =>
                                                    handleItemFieldUpdate(subItem.id, 'qty', e.target.value, doc.docketNoQtnNo)
                                                  }
                                                  className="w-16 p-1 border border-slate-200 rounded text-xs font-extrabold"
                                                />
                                              </td>
                                              <td className="p-2.5">
                                                <select
                                                  value={subItem.ourItemNot || ''}
                                                  onChange={(e) =>
                                                    handleItemFieldUpdate(subItem.id, 'ourItemNot', e.target.value, doc.docketNoQtnNo)
                                                  }
                                                  className="p-1 border border-slate-200 rounded text-xs font-bold"
                                                >
                                                  <option value="">Select</option>
                                                  <option value="MANUFACTURING">MANUFACTURING</option>
                                                  <option value="NO">NO</option>
                                                  <option value="TRADING">TRADING</option>
                                                </select>
                                              </td>
                                              <td className="p-2.5 font-bold text-blue-700 min-w-[200px]">
                                                 <div className="flex items-center space-x-1.5">
                                                   <select
                                                     value={subItem.ourItemName || ''}
                                                     onChange={(e) => {
                                                       handleItemFieldUpdate(subItem.id, 'ourItemName', e.target.value, doc.docketNoQtnNo);
                                                       if (e.target.value === 'OTHERS') {
                                                         openReasoningModal(subItem.itemNameParty, subItem.typeOfItem, e.target.value);
                                                       }
                                                     }}
                                                     className="w-full p-1 border border-slate-200 rounded text-xs font-extrabold text-blue-700"
                                                   >
                                                     <option value="">Select Item Name</option>
                                                     <option value="OTHERS">OTHERS</option>
                                                     {ourItemNameOptions.map((opt) => (
                                                       <option key={opt} value={opt}>
                                                         {opt}
                                                       </option>
                                                     ))}
                                                   </select>

                                                   {subItem.ourItemName && (
                                                     <button
                                                       onClick={() => openReasoningModal(subItem.itemNameParty, subItem.typeOfItem, subItem.ourItemName)}
                                                       className="p-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200 shrink-0"
                                                       title="View AI Factual Reasoning & Explanation for this Category"
                                                     >
                                                       <Brain className="w-3.5 h-3.5" />
                                                     </button>
                                                   )}
                                                 </div>
                                              </td>
                                              <td className="p-2.5">
                                                <AutoResizeTextarea
                                                  defaultValue={subItem.size || ''}
                                                  onSave={(val) =>
                                                    handleItemFieldUpdate(subItem.id, 'size', val, doc.docketNoQtnNo)
                                                  }
                                                />
                                              </td>
                                              <td className="p-2.5">
                                                <AutoResizeTextarea
                                                  defaultValue={subItem.sectionMm || ''}
                                                  onSave={(val) =>
                                                    handleItemFieldUpdate(subItem.id, 'sectionMm', val, doc.docketNoQtnNo)
                                                  }
                                                  placeholder="e.g. 125x65x6mm"
                                                />
                                              </td>
                                              <td className="p-2.5">
                                                <AutoResizeTextarea
                                                  defaultValue={subItem.sectionalWtKgMtr || ''}
                                                  onSave={(val) =>
                                                    handleItemFieldUpdate(subItem.id, 'sectionalWtKgMtr', val, doc.docketNoQtnNo)
                                                  }
                                                  placeholder="Kg/Mtr."
                                                />
                                              </td>
                                              <td className="p-2.5">
                                                <AutoResizeTextarea
                                                  defaultValue={subItem.lengthInMtr || ''}
                                                  onSave={(val) =>
                                                    handleItemFieldUpdate(subItem.id, 'lengthInMtr', val, doc.docketNoQtnNo)
                                                  }
                                                  placeholder="Mtr."
                                                />
                                              </td>
                                              <td className="p-2.5">
                                                <AutoResizeTextarea
                                                  defaultValue={subItem.unitWtOfMemberKg || ''}
                                                  onSave={(val) =>
                                                    handleItemFieldUpdate(subItem.id, 'unitWtOfMemberKg', val, doc.docketNoQtnNo)
                                                  }
                                                  placeholder="Kg"
                                                />
                                              </td>
                                              <td className="p-2.5 font-extrabold">
                                                <input
                                                  type="text"
                                                  defaultValue={subItem.price || ''}
                                                  onBlur={(e) =>
                                                    handleItemFieldUpdate(subItem.id, 'price', e.target.value, doc.docketNoQtnNo)
                                                  }
                                                  className="w-20 p-1 border border-slate-200 rounded text-xs font-extrabold"
                                                />
                                              </td>
                                              <td className="p-2.5">
                                                <select
                                                  value={subItem.status || ''}
                                                  onChange={(e) =>
                                                    handleItemFieldUpdate(subItem.id, 'status', e.target.value, doc.docketNoQtnNo)
                                                  }
                                                  className={`p-1 border rounded text-xs font-bold ${
                                                    subItem.status === 'Quoted'
                                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                                      : subItem.status === 'NOT Required'
                                                      ? 'bg-rose-50 text-rose-800 border-rose-300'
                                                      : 'bg-white border-slate-200'
                                                  }`}
                                                >
                                                  <option value="">Select Status</option>
                                                  {masterSuggestions.STATUS.map((st) => (
                                                    <option key={st} value={st}>
                                                      {st}
                                                    </option>
                                                  ))}
                                                </select>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: TREAM-AND-CONDITIONS */}
        {activeTab === 'terms' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden flex flex-col space-y-4 p-5">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold text-slate-900">tream-and-conditions Presets</h2>
                <p className="text-xs text-slate-500 font-medium">
                  Every field is editable. Editing options automatically updates available dropdown choices.
                </p>
              </div>
              <button
                onClick={() => setShowAddTerm(!showAddTerm)}
                className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold px-4 py-2.5 rounded-xl transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add Terms Preset</span>
              </button>
            </div>

            {/* Add Term Form */}
            {showAddTerm && (
              <form onSubmit={handleAddTerm} className="bg-slate-50 p-5 border border-slate-200 rounded-2xl space-y-4">
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
                    className="px-5 py-2 text-xs bg-blue-600 text-white rounded-xl font-extrabold hover:bg-blue-700 shadow-sm"
                  >
                    Save Options to DB
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto max-h-[680px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-800 font-extrabold sticky top-0 z-10 border-b border-slate-200 text-xs uppercase tracking-wider">
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
                          <textarea
                            defaultValue={t.price || ''}
                            onBlur={(e) => handleTermFieldUpdate(t.id, 'price', e.target.value)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <textarea
                            defaultValue={t.payment || ''}
                            onBlur={(e) => handleTermFieldUpdate(t.id, 'payment', e.target.value)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <textarea
                            defaultValue={t.delivery || ''}
                            onBlur={(e) => handleTermFieldUpdate(t.id, 'delivery', e.target.value)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <textarea
                            defaultValue={t.warranty || ''}
                            onBlur={(e) => handleTermFieldUpdate(t.id, 'warranty', e.target.value)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <textarea
                            defaultValue={t.approval || ''}
                            onBlur={(e) => handleTermFieldUpdate(t.id, 'approval', e.target.value)}
                            className="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded p-1.5 text-xs text-slate-900 focus:outline-none"
                            rows={2}
                          />
                        </td>
                        <td className="p-3.5">
                          <textarea
                            defaultValue={t.inspection || ''}
                            onBlur={(e) => handleTermFieldUpdate(t.id, 'inspection', e.target.value)}
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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden flex flex-col">
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-rose-600" />
                  edit-logs (Audit Change History)
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Appends a log entry with user static ID every time a record in `iteam-table`, `docket-party-name`, or `tream-and-conditions` is created/modified.
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
                  <option value="iteam-table">iteam-table</option>
                  <option value="docket-party-name">docket-party-name</option>
                  <option value="tream-and-conditions">tream-and-conditions</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[680px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-800 font-extrabold sticky top-0 z-10 border-b border-slate-200 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5">Log ID</th>
                    <th className="p-3.5">Table Name</th>
                    <th className="p-3.5">Record ID</th>
                    <th className="p-3.5">Field Changed</th>
                    <th className="p-3.5">Old Value</th>
                    <th className="p-3.5">New Value</th>
                    <th className="p-3.5">Timestamp</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 font-medium">
                  {logsLoading ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400 font-semibold">
                        Loading edit logs history...
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400 font-semibold">
                        No edit log entries found yet. Edit any table cell to test logging!
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/90 transition-colors">
                        <td className="p-3.5 font-mono text-xs font-bold text-slate-500">#{log.id}</td>
                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border ${
                              log.tableName === 'iteam-table'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : log.tableName === 'docket-party-name'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {log.tableName}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono font-bold text-slate-700">#{log.recordId}</td>
                        <td className="p-3.5 font-bold text-slate-900 flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-slate-400" />
                          {log.fieldName}
                        </td>
                        <td className="p-3.5 text-rose-700 max-w-[240px] truncate bg-rose-50/40 rounded px-2 py-1">
                          {log.oldValue || '<EMPTY>'}
                        </td>
                        <td className="p-3.5 text-emerald-700 max-w-[240px] truncate bg-emerald-50/40 rounded px-2 py-1 font-bold">
                          {log.newValue || '<EMPTY>'}
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
          <div className="bg-white rounded-2xl border border-amber-200 shadow-md overflow-hidden flex flex-col space-y-4 p-6">
            <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
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
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all border ${
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
            <form onSubmit={handleCreateMasterValue} className="bg-amber-50/50 border border-amber-200 p-4 rounded-2xl space-y-3">
              <h3 className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
                <PlusCircle className="w-4 h-4 text-amber-600" />
                Add New Master Option to Database
              </h3>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="w-48">
                  <label className="font-extrabold text-slate-700">Category:</label>
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
                  <label className="font-extrabold text-slate-700">New Option Value *:</label>
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
                    className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-5 py-2 rounded-xl text-xs shadow-sm transition-all flex items-center space-x-1.5"
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
                <thead className="bg-slate-100 text-slate-800 font-extrabold sticky top-0 z-10 border-b border-slate-200 text-[11px] uppercase tracking-wider">
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
                            defaultValue={m.value}
                            onSave={(newVal) => handleUpdateMasterValue(m.id, newVal)}
                            className="font-bold text-slate-900"
                          />
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleToggleMasterActive(m.id, m.isActive)}
                            className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold transition-all border ${
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

      {/* MODAL 1: ADD NEW DOCKET RECORD (WITH EXCEL BULK COPY-PASTE ITEM BOXES & AUTO-INCREMENTAL DOCKET NO) */}
      {showAddDocketModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-3xl w-full p-6 space-y-5 animate-in fade-in zoom-in duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-600 text-white p-2.5 rounded-2xl">
                  <Building className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Add New Docket Record</h3>
                  <p className="text-xs text-slate-500">
                    Logged in user: <strong className="text-blue-700">{currentUser.name} ({currentUser.id})</strong>
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
                  <label className="font-extrabold text-slate-700 flex items-center justify-between">
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
                    className={`w-full mt-1 p-2.5 border rounded-xl font-extrabold text-xs transition-all ${
                      currentUser.role === 'Admin'
                        ? 'bg-white border-blue-400 text-blue-700 focus:ring-2 focus:ring-blue-500/20'
                        : 'bg-slate-100 border-slate-300 text-slate-600 cursor-not-allowed'
                    }`}
                  />
                </div>

                <div>
                  <label className="font-extrabold text-slate-700">Party Name *:</label>
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
                  <label className="font-extrabold text-slate-700">Address:</label>
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
                  <label className="font-extrabold text-slate-700">State:</label>
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
                  <label className="font-extrabold text-slate-700">Utility:</label>
                  <input
                    type="text"
                    list="master-utilities"
                    placeholder="e.g. WBSEDCL / NBPDCL"
                    value={newDocketForm.utility}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, utility: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 font-medium"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="font-extrabold text-slate-700">Delivery Location:</label>
                  <input
                    type="text"
                    placeholder="e.g. Beldanga and Sitalpur, Bihar"
                    value={newDocketForm.deliveryLocation}
                    onChange={(e) => setNewDocketForm((prev) => ({ ...prev, deliveryLocation: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                {/* Terms Conditions selections */}
                <div>
                  <label className="font-extrabold text-slate-700">Price Condition:</label>
                  <select
                    value={newDocketForm.price}
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
                  <label className="font-extrabold text-slate-700">Payment Condition:</label>
                  <select
                    value={newDocketForm.payment}
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

              {/* LOWER SECTION: ITEM BOXES WITH EXCEL BULK COPY-PASTE SUPPORT */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-emerald-600" />
                      Add Line Items (Excel Copy-Paste Supported)
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Copy multiple item rows from Excel and paste into any box below to auto-generate item entries.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDocketItemsForm((prev) => [...prev, { itemNameParty: '', uom: '', qty: '' }])
                      }
                      className="inline-flex items-center space-x-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-extrabold text-xs px-3 py-1.5 rounded-xl transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Row Box</span>
                    </button>
                    {docketItemsForm.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDocketItemsForm([{ itemNameParty: '', uom: '', qty: '' }])}
                        className="text-xs text-rose-600 font-bold hover:underline px-2"
                      >
                        Reset Rows
                      </button>
                    )}
                  </div>
                </div>

                {/* ITEM BOXES LIST */}
                <div className="space-y-3.5 max-h-[320px] overflow-y-auto pr-1">
                  {docketItemsForm.map((row, index) => (
                    <div
                      key={index}
                      className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 relative group space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs font-extrabold text-slate-600">
                        <span>Item Box #{index + 1}</span>
                        {docketItemsForm.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setDocketItemsForm((prev) => prev.filter((_, i) => i !== index))
                            }
                            className="text-rose-600 hover:text-rose-700 font-bold p-1 rounded hover:bg-rose-50"
                            title="Remove Box"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="sm:col-span-1">
                          <label className="font-bold text-slate-700">ITEM NAME - PARTY *:</label>
                          <textarea
                            rows={2}
                            placeholder="Paste or type item name..."
                            value={row.itemNameParty}
                            onPaste={(e) => handlePasteItems(e, index, 'itemNameParty')}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDocketItemsForm((prev) =>
                                prev.map((r, i) => (i === index ? { ...r, itemNameParty: val } : r))
                              );
                            }}
                            className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 font-bold text-xs resize-y leading-snug"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-slate-700">UOM:</label>
                          <input
                            type="text"
                            placeholder="e.g. NOS / SET / kg"
                            value={row.uom}
                            onPaste={(e) => handlePasteItems(e, index, 'uom')}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDocketItemsForm((prev) =>
                                prev.map((r, i) => (i === index ? { ...r, uom: val } : r))
                              );
                            }}
                            className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 text-xs font-semibold"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-slate-700">QTY:</label>
                          <input
                            type="text"
                            placeholder="e.g. 100"
                            value={row.qty}
                            onPaste={(e) => handlePasteItems(e, index, 'qty')}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDocketItemsForm((prev) =>
                                prev.map((r, i) => (i === index ? { ...r, qty: val } : r))
                              );
                            }}
                            className="w-full mt-1 p-2 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 text-xs font-bold text-slate-900"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
                  className="px-6 py-2.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-extrabold shadow-md shadow-blue-500/20"
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
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="bg-emerald-600 text-white p-2 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
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
                  <label className="font-extrabold text-slate-700">Docket / Qtn No:</label>
                  <input
                    type="text"
                    required
                    value={newItemForm.docketNoQtnNo}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, docketNoQtnNo: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-bold text-blue-600"
                  />
                </div>

                <div>
                  <label className="font-extrabold text-slate-700">ITEM NAME - PARTY *:</label>
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
                  <label className="font-extrabold text-slate-700">UOM:</label>
                  <input
                    type="text"
                    placeholder="e.g. NOS / kg / SET"
                    value={newItemForm.uom}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, uom: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="font-extrabold text-slate-700">QTY:</label>
                  <input
                    type="text"
                    placeholder="e.g. 100"
                    value={newItemForm.qty}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, qty: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-semibold"
                  />
                </div>

                <div>
                  <label className="font-extrabold text-slate-700">OUR ITEM / NOT:</label>
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
                  <label className="font-extrabold text-slate-700">Our Item Name:</label>
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
                  <label className="font-extrabold text-slate-700">Size:</label>
                  <input
                    type="text"
                    placeholder="e.g. 100x50x6mm"
                    value={newItemForm.size}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, size: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="font-extrabold text-slate-700">Price:</label>
                  <input
                    type="text"
                    placeholder="e.g. 1950"
                    value={newItemForm.price}
                    onChange={(e) => setNewItemForm((prev) => ({ ...prev, price: e.target.value }))}
                    className="w-full mt-1 p-2.5 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white font-extrabold text-slate-900"
                  />
                </div>

                <div>
                  <label className="font-extrabold text-slate-700">Status:</label>
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
                  className="px-6 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold shadow-md shadow-emerald-500/20"
                >
                  Save Item to Docket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
