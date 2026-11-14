/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  setDoc,
  doc, 
  query, 
  orderBy, 
  Timestamp,
  getDocFromServer,
  deleteDoc,
  getDocs,
  writeBatch,
  where
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  Plus, 
  Search, 
  Filter, 
  LogOut, 
  Settings, 
  ChevronRight, 
  Calendar, 
  User as UserIcon, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  AlertTriangle,
  Trash2,
  Edit3,
  X,
  Check,
  BarChart3,
  TrendingUp,
  History,
  FileSpreadsheet,
  Download,
  Upload,
  Loader2,
  ChevronDown,
  Copy,
  Sparkles,
  BookOpen,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  FileCheck,
  RefreshCw,
  UserCheck,
  UserX
} from 'lucide-react';
import { format, addDays, differenceInDays, isAfter, isBefore, startOfDay, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { read, utils, writeFile } from 'xlsx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import NotificationsPanel from './components/NotificationsPanel';
import NotificationTemplatesManager from './components/NotificationTemplatesManager';
import { SystemTutorial } from './components/SystemTutorial';
import { ConfigPasswordGate } from './components/ConfigPasswordGate';
import UserManagementPanel, { UserProfile } from './components/UserManagementPanel';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to parse "yyyy-MM-dd" date strings into local Date objects at noon to avoid timezone timezone-shifting bugs.
function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(dateStr);
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return new Date(year, month - 1, day, 12, 0, 0);
}

// Types
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

interface Batch {
  id: string;
  pac: string;
  periodoInicial: Timestamp;
  periodoFinal: Timestamp;
  numEnsaios: number;
  status: string;
  recebidoPor: string;
  recebidoEm: Timestamp;
  lidoPor?: string;
  lidoEm?: Timestamp;
  conferidoPor?: string;
  conferidoEm?: Timestamp;
  ensaioForaDoPrazo?: boolean;
  nonConformities?: any[];
}

interface ConfigItem {
  id: string;
  name: string;
  color?: string;
  rule?: any;
  templates?: any;
}

class LocalTimestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  toDate() {
    return new Date(this.seconds * 1000);
  }
  toMillis() {
    return this.seconds * 1000;
  }
  isEqual(other: any) {
    return other && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds, type: 'timestamp' };
  }
  valueOf() {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`;
  }
  static now() {
    return new LocalTimestamp(Math.floor(Date.now() / 1000), 0);
  }
  static fromDate(date: Date) {
    return new LocalTimestamp(Math.floor(date.getTime() / 1000), 0);
  }
  static fromMillis(ms: number) {
    return new LocalTimestamp(Math.floor(ms / 1000), 0);
  }
}

function parseLocalTimestamp(raw: any): any {
  if (!raw) return null;
  if (typeof raw.toDate === 'function') return raw;
  if (typeof raw === 'object' && raw.seconds !== undefined) {
    return new LocalTimestamp(raw.seconds, raw.nanoseconds || 0);
  }
  if (typeof raw === 'string') {
    return LocalTimestamp.fromDate(new Date(raw));
  }
  if (typeof raw === 'number') {
    return LocalTimestamp.fromMillis(raw);
  }
  return LocalTimestamp.now();
}

function toSafeDate(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') {
    try {
      const d = ts.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (ts instanceof Date) {
    return !isNaN(ts.getTime()) ? ts : null;
  }
  if (typeof ts === 'object' && typeof ts.seconds === 'number') {
    const d = new Date(ts.seconds * 1000);
    return !isNaN(d.getTime()) ? d : null;
  }
  if (typeof ts === 'string' || typeof ts === 'number') {
    const d = new Date(ts);
    return !isNaN(d.getTime()) ? d : null;
  }
  return null;
}

// Regra Oficial de Prazo de Entrega do PAC:
// 10 dias a partir da Data Inicial do Lote + 7 dias de tolerância de envio (Correios) = 17 dias corridos até a Data de Recebimento sem prejuízo ao PAC.
// Permite também ampliações ou desconsideração de prazos em períodos de recesso ou feriados configurados no sistema.
export const PRAZO_BASE_PAC_DIAS = 10;
export const TOLERANCIA_CORREIOS_DIAS = 7;
export const PRAZO_MAXIMO_ENTREGA_PAC_DIAS = PRAZO_BASE_PAC_DIAS + TOLERANCIA_CORREIOS_DIAS; // 17 dias

export interface DeadlineExtension {
  id: string;
  name: string;
  startDate: string; // yyyy-MM-dd
  endDate: string;   // yyyy-MM-dd
  mode: 'add_days' | 'disregard'; // 'add_days' = Adicionar dias ao prazo | 'disregard' = Desconsiderar prazo no período
  customDays?: number;
  active: boolean;
  createdAt?: string;
}

let globalDeadlineExtensions: DeadlineExtension[] = (() => {
  try {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('lotes_deadline_extensions') : null;
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
})();

export function setGlobalDeadlineExtensions(exts: DeadlineExtension[]) {
  globalDeadlineExtensions = Array.isArray(exts) ? exts : [];
}

export function getGlobalDeadlineExtensions(): DeadlineExtension[] {
  return globalDeadlineExtensions;
}

export function evaluatePacDeliveryDeadline(
  periodoInicial: any,
  recebidoEm: any,
  manualFlag?: any,
  extensionsOverride?: DeadlineExtension[]
) {
  const pInicialDate = toSafeDate(periodoInicial);
  const recebidoEmDate = toSafeDate(recebidoEm);
  const activeExtensions = (extensionsOverride || globalDeadlineExtensions).filter(
    e => e && e.active !== false && e.startDate && e.endDate
  );

  let addedExtensionDays = 0;
  let isDisregardedByRecess = false;
  const appliedExtensions: Array<{
    id: string;
    name: string;
    mode: 'add_days' | 'disregard';
    daysAdded: number;
    startDate: string;
    endDate: string;
  }> = [];

  if (pInicialDate && activeExtensions.length > 0) {
    const batchStart = startOfDay(pInicialDate);
    const baseMaxEnd = addDays(batchStart, PRAZO_MAXIMO_ENTREGA_PAC_DIAS);
    const batchCheckEnd = recebidoEmDate
      ? (isAfter(startOfDay(recebidoEmDate), baseMaxEnd) ? startOfDay(recebidoEmDate) : baseMaxEnd)
      : baseMaxEnd;

    activeExtensions.forEach(ext => {
      const extStart = startOfDay(parseLocalDate(ext.startDate));
      const extEnd = startOfDay(parseLocalDate(ext.endDate));
      if (isNaN(extStart.getTime()) || isNaN(extEnd.getTime())) return;

      const overlaps = !isAfter(batchStart, extEnd) && !isBefore(batchCheckEnd, extStart);
      if (overlaps) {
        const intervalDays = Math.max(1, differenceInDays(extEnd, extStart) + 1);
        const daysToAdd = ext.mode === 'add_days'
          ? (typeof ext.customDays === 'number' && ext.customDays > 0 ? ext.customDays : intervalDays)
          : 0;

        if (ext.mode === 'disregard') {
          isDisregardedByRecess = true;
        } else if (ext.mode === 'add_days') {
          addedExtensionDays += daysToAdd;
        }

        appliedExtensions.push({
          id: ext.id,
          name: ext.name,
          mode: ext.mode,
          daysAdded: daysToAdd,
          startDate: ext.startDate,
          endDate: ext.endDate
        });
      }
    });
  }

  const effectiveMaxDays = PRAZO_MAXIMO_ENTREGA_PAC_DIAS + addedExtensionDays;
  const baseDeadlineDate = pInicialDate ? addDays(startOfDay(pInicialDate), PRAZO_BASE_PAC_DIAS) : null;
  const maxDeadlineDate = pInicialDate ? addDays(startOfDay(pInicialDate), effectiveMaxDays) : null;
  const elapsedDays = (pInicialDate && recebidoEmDate)
    ? differenceInDays(startOfDay(recebidoEmDate), startOfDay(pInicialDate))
    : null;

  const isOver17Days = !isDisregardedByRecess && elapsedDays !== null && elapsedDays > effectiveMaxDays;
  const isWithinCorreiosTolerance = !isDisregardedByRecess && elapsedDays !== null && elapsedDays > PRAZO_BASE_PAC_DIAS && elapsedDays <= effectiveMaxDays;
  const isExemptByCheckbox = manualFlag === false || manualFlag === 'false';

  let isLate = false;
  if (isExemptByCheckbox || isDisregardedByRecess) {
    // Quando o checkbox do lote está desmarcado (manualFlag === false) ou há recesso isentando o período, o lote fica isento do atraso
    isLate = false;
  } else if (addedExtensionDays > 0 && elapsedDays !== null) {
    isLate = elapsedDays > effectiveMaxDays;
  } else if (elapsedDays !== null && elapsedDays <= effectiveMaxDays) {
    // Dentro do prazo de 17d (10d + 7d Correios), não penaliza o PAC mesmo que tenha flag antiga da regra de 10d
    isLate = false;
  } else {
    isLate = Boolean(manualFlag === true || manualFlag === 'true' || isOver17Days);
  }

  const daysOverLimit = isOver17Days && elapsedDays !== null
    ? elapsedDays - effectiveMaxDays
    : 0;

  return {
    pInicialDate,
    recebidoEmDate,
    baseDeadlineDate,
    maxDeadlineDate,
    effectiveMaxDays,
    addedExtensionDays,
    isDisregardedByRecess,
    isExemptByCheckbox,
    appliedExtensions,
    elapsedDays,
    isOver17Days,
    isWithinCorreiosTolerance,
    isLate,
    daysOverLimit
  };
}

interface AuthErrorDetails {
  code: string;
  title: string;
  message: string;
  actionHtml?: string;
}

function parseAuthError(err: any): AuthErrorDetails {
  const code = err?.code || '';
  const message = err?.message || String(err);
  
  if (code === 'auth/unauthorized-domain' || message.includes('unauthorized-domain') || message.includes('domain is not authorized')) {
    const currentDomain = window.location.hostname;
    return {
      code: 'auth/unauthorized-domain',
      title: 'Domínio Não Autorizado',
      message: `O domínio atual (${currentDomain}) não está na lista de domínios autorizados no Firebase.`,
      actionHtml: `
        <div class="mt-3 text-sm space-y-2 text-[#5a5a40]">
          <p>Para corrigir, siga os passos abaixo no seu painel do Firebase (ID do Projeto: <strong class="select-all bg-[#f5f5f0] px-1 rounded">ai-studio-applet-webapp-71b30</strong>):</p>
          <ol class="list-decimal list-inside space-y-2 pl-1 bg-[#f5f5f0] p-4 rounded-xl border border-[#e5e5e0] text-xs text-left">
            <li>Acesse o link direto do console Firebase: <br/>
              <a href="https://console.firebase.google.com/project/ai-studio-applet-webapp-71b30/authentication/settings" target="_blank" rel="noopener noreferrer" class="underline font-bold text-blue-600 hover:text-blue-800 break-all">
                Abrir Painel de Configurações
              </a>
            </li>
            <li>Encontre a seção de <strong>"Domínios autorizados"</strong> (Authorized domains).</li>
            <li>Clique em <strong>"Adicionar domínio"</strong>.</li>
            <li>Insira este domínio exatamente: <code class="bg-white border border-[#e5e5e0] px-1.5 py-0.5 rounded text-red-600 font-mono text-xs select-all font-bold">${currentDomain}</code> e clique em <strong>Adicionar</strong>.</li>
            <li>Caso precise carregar no editor ou painel de desenvolvimento, verifique se também adicionou: <br/><code class="bg-white border border-[#e5e5e0] px-1.5 py-0.5 rounded font-mono text-xs select-all font-bold">ais-dev-2wvwziemydj4o6k52si3ec-323441203869.us-east1.run.app</code>.</li>
          </ol>
          <p class="text-xs text-[#5a5a40]/80">Após realizar este passo no console do Firebase, basta atualizar esta página e tentar o login novamente!</p>
        </div>
      `
    };
  }
  
  if (code === 'auth/operation-not-allowed' || message.includes('operation-not-allowed')) {
    return {
      code: 'auth/operation-not-allowed',
      title: 'Login Google Desabilitado',
      message: 'O provedor de login com Google não foi ativado no painel de controle do Firebase.',
      actionHtml: `
        <div class="mt-3 text-sm space-y-2 text-[#5a5a40]">
          <p>Para ativar o login social:</p>
          <ol class="list-decimal list-inside space-y-2 pl-1 bg-[#f5f5f0] p-4 rounded-xl border border-[#e5e5e0] text-xs text-left">
            <li>Acesse o link: <br/>
              <a href="https://console.firebase.google.com/project/ai-studio-applet-webapp-71b30/authentication/providers" target="_blank" rel="noopener noreferrer" class="underline font-bold text-blue-600 hover:text-blue-800 break-all">
                Abrir Métodos de Login no Firebase
              </a>
            </li>
            <li>Clique em <strong>"Adicionar novo provedor"</strong> e selecione <strong>Google</strong>.</li>
            <li>Ative o provedor, selecione um <strong>e-mail de suporte</strong> do projeto e clique em <strong>Salvar</strong>.</li>
          </ol>
        </div>
      `
    };
  }

  if (code === 'auth/popup-blocked') {
    return {
      code,
      title: 'Popup Bloqueado pelo Navegador',
      message: 'A janela pop-up de login do Google foi bloqueada pelo seu navegador.',
      actionHtml: `
        <div class="mt-3 text-sm space-y-1 text-[#5a5a40] text-left">
          <p>Como resolver:</p>
          <ul class="list-disc list-inside space-y-1 pl-1 text-xs">
            <li>Procure pelo ícone de popup bloqueado na barra de endereços (geralmente no canto superior direito) e selecione <strong>Sempre permitir popups deste site</strong>.</li>
            <li>Após habilitar, tente clicar em <strong>"Entrar com Google"</strong> novamente.</li>
            <li>Ou utilize o <strong>Acesso Demonstrativo Local</strong> abaixo para usar offline!</li>
          </ul>
        </div>
      `
    };
  }

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      code,
      title: 'Login Cancelado',
      message: 'A janela de login com o Google foi fechada antes de o login ser concluído.',
      actionHtml: `
        <div class="mt-3 text-sm text-[#5a5a40] text-xs text-left">
          <p>Por favor, clique em <strong>"Entrar com Google"</strong> novamente para tentar outra vez.</p>
        </div>
      `
    };
  }

  return {
    code,
    title: 'Erro de Autenticação',
    message: message || 'Não foi possível efetuar o login usando a Conta Google.',
    actionHtml: `
      <div class="mt-3 text-xs text-[#5a5a40]/90 text-left">
        <p class="font-mono text-[11px] bg-[#f5f5f0] p-2 rounded border border-[#e5e5e0] text-red-600 break-all">Código: ${code || 'Desconhecido'}<br/>Mensagem: ${message}</p>
        <p class="mt-2 text-xs">Tente novamente ou use o <strong>Acesso Demonstrativo Local</strong> para testar as funcionalidades do aplicativo imediatamente.</p>
      </div>
    `
  };
}

function PendingApprovalScreen({ user, onRefresh, onLogout }: { user: any; onRefresh: () => void; onLogout: () => void }) {
  const [checking, setChecking] = useState(false);

  const handleCheckAgain = async () => {
    setChecking(true);
    await onRefresh();
    setTimeout(() => setChecking(false), 600);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-[32px] border border-[#e5e5e0] shadow-2xl p-8 text-center animate-in fade-in zoom-in duration-200">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 mx-auto mb-6 shadow-inner">
          <Clock size={32} className="animate-pulse" />
        </div>
        
        <span className="inline-block px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full uppercase tracking-wider mb-3">
          Solicitação de Acesso em Análise
        </span>

        <h2 className="text-2xl font-display font-bold text-gray-900 tracking-tight mb-2">
          Aguardando Liberação do Administrador
        </h2>

        <p className="text-sm text-[#5A5A40] leading-relaxed mb-6">
          Olá, <strong>{user?.displayName || 'Usuário'}</strong>! Sua conta de e-mail <strong>{user?.email}</strong> foi cadastrada com sucesso.
          O seu acesso precisa ser aprovado por um Administrador do IPEM-PR antes de utilizar o sistema.
        </p>

        <div className="bg-[#f5f5f0] p-4 rounded-2xl border border-[#e5e5e0] text-left text-xs space-y-2 mb-6">
          <div className="flex justify-between items-center">
            <span className="text-gray-500 font-medium">E-mail solicitado:</span>
            <span className="font-bold text-gray-800 font-mono">{user?.email}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500 font-medium">Status do pedido:</span>
            <span className="font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md">Pendente de Liberação</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500 font-medium">Data do cadastro:</span>
            <span className="font-bold text-gray-700">{format(new Date(), "dd/MM/yyyy HH:mm")}</span>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleCheckAgain}
            disabled={checking}
            className="w-full py-3.5 bg-[#5A5A40] text-white font-semibold text-sm rounded-2xl hover:bg-[#4a4a30] transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
          >
            {checking ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            <span>Verificar se já foi aprovado</span>
          </button>

          <button
            onClick={onLogout}
            className="w-full py-3.5 bg-gray-100 text-gray-700 font-semibold text-sm rounded-2xl hover:bg-gray-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut size={18} />
            <span>Sair / Entrar com outra conta</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessDeniedScreen({ user, onLogout }: { user: any; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-[32px] border border-red-200 shadow-2xl p-8 text-center animate-in fade-in zoom-in duration-200">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto mb-6 shadow-inner">
          <AlertCircle size={32} />
        </div>
        
        <span className="inline-block px-3 py-1 bg-red-100 text-red-800 text-xs font-bold rounded-full uppercase tracking-wider mb-3">
          Acesso Não Aprovado
        </span>

        <h2 className="text-2xl font-display font-bold text-gray-900 tracking-tight mb-2">
          Acesso Recusado ao Sistema
        </h2>

        <p className="text-sm text-[#5A5A40] leading-relaxed mb-6">
          A solicitação de acesso para a conta de e-mail <strong>{user?.email}</strong> não foi aprovada pelo Administrador do sistema.
        </p>

        <button
          onClick={onLogout}
          className="w-full py-3.5 bg-red-600 text-white font-semibold text-sm rounded-2xl hover:bg-red-700 transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
        >
          <LogOut size={18} />
          <span>Sair do Sistema</span>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [isLocalMode, setIsLocalMode] = useState(() => {
    return localStorage.getItem('lotes_isLocalMode') === 'true';
  });
  const [user, setUser] = useState<User | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [userProfileLoading, setUserProfileLoading] = useState<boolean>(true);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pacs, setPacs] = useState<ConfigItem[]>([]);
  const [collaborators, setCollaborators] = useState<ConfigItem[]>([]);
  const [statuses, setStatuses] = useState<ConfigItem[]>([]);
  const [nonConformitiesConfigs, setNonConformitiesConfigs] = useState<ConfigItem[]>([]);
  const [framings, setFramings] = useState<any[]>([]);
  const [nonConformityRecords, setNonConformityRecords] = useState<any[]>([]);
  const [notificationTypes, setNotificationTypes] = useState<ConfigItem[]>([]);
  const [generatedNotifications, setGeneratedNotifications] = useState<any[]>([]);
  
  interface Signature {
    id: string;
    name: string;
    role: string;
    imageUrl: string;
  }

  const [logoUrl, setLogoUrl] = useState<string>(() => {
    return localStorage.getItem('lotes_logoUrl') || '';
  });

  const [signatures, setSignatures] = useState<Signature[]>(() => {
    try {
      const saved = localStorage.getItem('lotes_signatures');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveLogoUrl = async (newUrl: string) => {
    setLogoUrl(newUrl);
    if (newUrl) {
      localStorage.setItem('lotes_logoUrl', newUrl);
    } else {
      localStorage.removeItem('lotes_logoUrl');
    }
    if (!isLocalMode) {
      try {
        await setDoc(doc(db, 'configs', 'branding'), { logoUrl: newUrl }, { merge: true });
      } catch (err) {
        console.error("Erro ao salvar logo no Firestore:", err);
        handleFirestoreError(err, OperationType.WRITE, 'configs/branding');
      }
    }
  };

  const saveSignatures = async (newSigs: Signature[]) => {
    setSignatures(newSigs);
    localStorage.setItem('lotes_signatures', JSON.stringify(newSigs));
    if (!isLocalMode) {
      try {
        await setDoc(doc(db, 'configs', 'branding'), { signatures: newSigs }, { merge: true });
      } catch (err) {
        console.error("Erro ao salvar assinaturas no Firestore:", err);
        handleFirestoreError(err, OperationType.WRITE, 'configs/branding');
      }
    }
  };

  const [configPassword, setConfigPassword] = useState<string>(() => {
    return localStorage.getItem('lotes_config_password') || '32512240';
  });

  const [isConfigUnlocked, setIsConfigUnlocked] = useState<boolean>(() => {
    return localStorage.getItem('lotes_config_unlocked') === 'true';
  });

  const saveConfigPassword = async (newPassword: string) => {
    setConfigPassword(newPassword);
    localStorage.setItem('lotes_config_password', newPassword);
    if (!isLocalMode) {
      try {
        await setDoc(doc(db, 'configs', 'security'), { password: newPassword }, { merge: true });
      } catch (err) {
        console.error("Erro ao salvar senha no Firestore:", err);
        handleFirestoreError(err, OperationType.WRITE, 'configs/security');
      }
    }
  };

  const [deadlineExtensions, setDeadlineExtensions] = useState<DeadlineExtension[]>(() => {
    try {
      const saved = localStorage.getItem('lotes_deadline_extensions');
      const parsed = saved ? JSON.parse(saved) : [];
      setGlobalDeadlineExtensions(parsed);
      return parsed;
    } catch {
      return [];
    }
  });

  useEffect(() => {
    setGlobalDeadlineExtensions(deadlineExtensions);
  }, [deadlineExtensions]);

  const saveDeadlineExtensions = async (newExtensions: DeadlineExtension[]) => {
    setDeadlineExtensions(newExtensions);
    setGlobalDeadlineExtensions(newExtensions);
    localStorage.setItem('lotes_deadline_extensions', JSON.stringify(newExtensions));
    if (!isLocalMode) {
      try {
        await setDoc(doc(db, 'configs', 'deadlines'), { items: newExtensions }, { merge: true });
      } catch (err) {
        console.error("Erro ao salvar ampliações de prazo no Firestore:", err);
        handleFirestoreError(err, OperationType.WRITE, 'configs/deadlines');
      }
    }
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('open'); // Changed default to 'open'
  const [activeTab, setActiveTab] = useState<'dashboard' | 'config' | 'stats' | 'notifications' | 'tutorial' | 'users'>('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [batchToDelete, setBatchToDelete] = useState<string | null>(null);
  const [configToDelete, setConfigToDelete] = useState<{type: string, id: string} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleLoginError, setGoogleLoginError] = useState<any | null>(null);
  const [quotaFallbackNotice, setQuotaFallbackNotice] = useState(() => {
    return localStorage.getItem('lotes_quota_exceeded_fallback') === 'true';
  });

  // Dashboard Period States
  const currentYearNum = new Date().getFullYear();
  const defaultCurrentYearStart = useMemo(() => `${currentYearNum}-01-01`, [currentYearNum]);
  const defaultCurrentYearEnd = useMemo(() => `${currentYearNum}-12-31`, [currentYearNum]);

  const defaultDashStart = useMemo(() => format(new Date(currentYearNum, new Date().getMonth(), 1), 'yyyy-MM-dd'), [currentYearNum]);
  const defaultDashEnd = useMemo(() => format(new Date(currentYearNum, new Date().getMonth() + 1, 0), 'yyyy-MM-dd'), [currentYearNum]);

  // Default to current year filter (Ano Vigente) to optimize initial load and prevent lag
  const [dashStartDate, setDashStartDate] = useState<string>(defaultCurrentYearStart);
  const [dashEndDate, setDashEndDate] = useState<string>(defaultCurrentYearEnd);
  const [visibleBatchLimit, setVisibleBatchLimit] = useState<number>(30);

  // Reset pagination limit whenever filters change
  useEffect(() => {
    setVisibleBatchLimit(30);
  }, [searchTerm, statusFilter, dashStartDate, dashEndDate]);

  // Error Handler
  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errInfo: FirestoreErrorInfo = {
      error: errorMsg,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));

    if (isLocalMode) {
      console.warn("Firestore error in local mode (ignored):", errorMsg);
      return;
    }

    const isQuota = (errorMsg.toLowerCase().includes('quota') || 
                    errorMsg.toLowerCase().includes('exceeded') || 
                    errorMsg.toLowerCase().includes('cota') || 
                    errorMsg.toLowerCase().includes('limite') || 
                    errorMsg.toLowerCase().includes('reached')) && 
                    !errorMsg.toLowerCase().includes('permission');

    if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('insufficient')) {
      setError("Acesso Negado / Permissão Insuficiente: Certifique-se de que está logado com uma conta Google autorizada e acessando através de uma aba independente (fora do iFrame).");
      return;
    }

    if (isQuota) {
      console.warn("Quota exceeded detected! Automatically switching to Local Mode to prevent disruption.");
      localStorage.setItem('lotes_isLocalMode', 'true');
      localStorage.setItem('lotes_quota_exceeded_fallback', 'true');
      
      // Save what we can
      if (batches && batches.length > 0) {
        try { localStorage.setItem('lotes_batches', JSON.stringify(batches)); } catch(e){}
      }
      if (pacs && pacs.length > 0) {
        try { localStorage.setItem('lotes_pacs', JSON.stringify(pacs)); } catch(e){}
      }
      if (collaborators && collaborators.length > 0) {
        try { localStorage.setItem('lotes_collaborators', JSON.stringify(collaborators)); } catch(e){}
      }
      if (statuses && statuses.length > 0) {
        try { localStorage.setItem('lotes_statuses', JSON.stringify(statuses)); } catch(e){}
      }
      if (nonConformitiesConfigs && nonConformitiesConfigs.length > 0) {
        try { localStorage.setItem('lotes_non_conformities_configs', JSON.stringify(nonConformitiesConfigs)); } catch(e){}
      }
      if (nonConformityRecords && nonConformityRecords.length > 0) {
        try { localStorage.setItem('lotes_non_conformities', JSON.stringify(nonConformityRecords)); } catch(e){}
      }
      if (notificationTypes && notificationTypes.length > 0) {
        try { localStorage.setItem('lotes_notification_types', JSON.stringify(notificationTypes)); } catch(e){}
      }
      if (framings && framings.length > 0) {
        try { localStorage.setItem('lotes_framings', JSON.stringify(framings)); } catch(e){}
      }
      if (generatedNotifications && generatedNotifications.length > 0) {
        try { localStorage.setItem('lotes_notifications', JSON.stringify(generatedNotifications)); } catch(e){}
      }

      window.location.reload();
      return;
    }

    setError(`Erro na operação ${operationType}: ${errInfo.error}`);
  };

  // Auth
  useEffect(() => {
    const isLocal = localStorage.getItem('lotes_isLocalMode') === 'true';
    if (isLocal) {
      setUser({
        uid: 'client-demo',
        email: 'demo@ipempr.org',
        displayName: 'Convidado Local',
        emailVerified: true
      } as any);
      setLoading(false);
      setIsLocalMode(true);
    } else {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        setUser(user);
        setLoading(false);
      });
      return () => unsubscribe();
    }
  }, []);

  const handleLogin = async () => {
    setGoogleLoginError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error(err);
      setGoogleLoginError(err);
    }
  };

  const handleLocalLogin = () => {
    setIsLocalMode(true);
    localStorage.setItem('lotes_isLocalMode', 'true');
    setUser({
      uid: 'client-demo',
      email: 'demo@ipempr.org',
      displayName: 'Convidado Local',
      emailVerified: true
    } as any);
  };

  const enableLocalMode = () => {
    setIsLocalMode(true);
    localStorage.setItem('lotes_isLocalMode', 'true');
    setUser({
      uid: 'client-demo',
      email: user?.email || 'demo@ipempr.org',
      displayName: user?.displayName || 'Convidado Local',
      emailVerified: true
    } as any);
    setError(null);
    window.location.reload();
  };

  const handleLogout = () => {
    localStorage.removeItem('lotes_isLocalMode');
    setIsLocalMode(false);
    signOut(auth);
    setUser(null);
  };

  // User Profile Firestore Sync
  useEffect(() => {
    if (isLocalMode) {
      setCurrentUserProfile({
        uid: 'client-demo',
        email: user?.email || 'demo@ipempr.org',
        displayName: user?.displayName || 'Convidado Local',
        role: 'ADMIN',
        status: 'APPROVED'
      });
      setUserProfileLoading(false);
      return;
    }

    if (!user) {
      setCurrentUserProfile(null);
      setUserProfileLoading(false);
      return;
    }

    setUserProfileLoading(true);
    const profileRef = doc(db, 'user_profiles', user.uid);

    const unsub = onSnapshot(profileRef, async (snap) => {
      if (!snap.exists()) {
        const isInitialAdmin = user.email?.toLowerCase() === 'ipempr.site@gmail.com';
        
        let initialRole: 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR' = isInitialAdmin ? 'ADMIN' : 'OPERADOR';
        let initialStatus: 'PENDING' | 'APPROVED' | 'REJECTED' = isInitialAdmin ? 'APPROVED' : 'PENDING';
        let approvedBy = isInitialAdmin ? 'Sistema (Admin Padrão)' : undefined;

        // Check if user email was pre-approved by Admin
        try {
          const userEmailNormalized = user.email?.toLowerCase().trim() || '';
          if (userEmailNormalized) {
            const qPre = query(collection(db, 'user_profiles'), where('email', '==', userEmailNormalized));
            const preSnap = await getDocs(qPre);
            if (!preSnap.empty) {
              const preData = preSnap.docs[0].data() as UserProfile;
              initialRole = preData.role || initialRole;
              initialStatus = preData.status || initialStatus;
              approvedBy = preData.approvedBy || 'Pré-aprovado pelo Administrador';

              if (preSnap.docs[0].id !== user.uid) {
                deleteDoc(preSnap.docs[0].ref).catch(() => {});
              }
            }
          }
        } catch (e) {
          console.warn("Verificação de pré-aprovação:", e);
        }

        const initialProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || user.email || 'Usuário',
          photoURL: user.photoURL || '',
          role: initialRole,
          status: initialStatus,
          approvedBy,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        try {
          await setDoc(profileRef, initialProfile);
          setCurrentUserProfile(initialProfile);
        } catch (err) {
          console.error("Erro ao registrar perfil do usuário:", err);
          handleFirestoreError(err, OperationType.WRITE, `user_profiles/${user.uid}`);
        }
      } else {
        const data = snap.data() as UserProfile;
        setCurrentUserProfile(data);
      }
      setUserProfileLoading(false);
    }, (err) => {
      console.error("Erro ao observar perfil do usuário:", err);
      setUserProfileLoading(false);
    });

    return () => unsub();
  }, [user, isLocalMode]);

  // Fetch all user profiles for Admin
  useEffect(() => {
    if (isLocalMode) {
      setAllUsers([
        {
          uid: 'client-demo',
          email: user?.email || 'demo@ipempr.org',
          displayName: user?.displayName || 'Convidado Local',
          role: 'ADMIN',
          status: 'APPROVED'
        }
      ]);
      return;
    }

    if (currentUserProfile?.role !== 'ADMIN') {
      setAllUsers([]);
      return;
    }

    const q = query(collection(db, 'user_profiles'));
    const unsub = onSnapshot(q, (snap) => {
      const list: UserProfile[] = [];
      snap.forEach((d) => {
        list.push(d.data() as UserProfile);
      });
      setAllUsers(list);
    }, (err) => {
      console.error("Erro ao carregar lista de usuários:", err);
    });

    return () => unsub();
  }, [currentUserProfile?.role, isLocalMode]);

  const handleUpdateUserStatus = async (
    targetUid: string,
    newStatus: 'APPROVED' | 'PENDING' | 'REJECTED',
    newRole: 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR'
  ) => {
    if (isLocalMode) {
      setAllUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, status: newStatus, role: newRole } : u));
      return;
    }

    try {
      await setDoc(doc(db, 'user_profiles', targetUid), {
        status: newStatus,
        role: newRole,
        approvedBy: currentUserProfile?.email || user?.email || 'Administrador',
        updatedAt: Timestamp.now()
      }, { merge: true });
    } catch (err) {
      console.error("Erro ao atualizar perfil do usuário:", err);
      handleFirestoreError(err, OperationType.UPDATE, `user_profiles/${targetUid}`);
    }
  };

  const handleAddPreApprovedUser = async (
    email: string,
    displayName: string,
    role: 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR'
  ) => {
    const normalizedEmail = email.toLowerCase().trim();
    const docId = `pre_${normalizedEmail.replace(/[^a-z0-9]/g, '_')}`;

    const newProfile: UserProfile = {
      uid: docId,
      email: normalizedEmail,
      displayName: displayName.trim() || normalizedEmail.split('@')[0],
      role: role,
      status: 'APPROVED',
      approvedBy: currentUserProfile?.email || user?.email || 'Administrador',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };

    if (isLocalMode) {
      setAllUsers(prev => [...prev.filter(u => u.email !== normalizedEmail), newProfile]);
      return;
    }

    try {
      await setDoc(doc(db, 'user_profiles', docId), newProfile);
    } catch (err) {
      console.error("Erro ao pré-aprovar e-mail:", err);
      handleFirestoreError(err, OperationType.WRITE, `user_profiles/${docId}`);
    }
  };

  const handleDeleteUserProfile = async (targetUid: string) => {
    if (isLocalMode) {
      setAllUsers(prev => prev.filter(u => u.uid !== targetUid));
      return;
    }

    try {
      await deleteDoc(doc(db, 'user_profiles', targetUid));
    } catch (err) {
      console.error("Erro ao excluir perfil de usuário:", err);
      handleFirestoreError(err, OperationType.DELETE, `user_profiles/${targetUid}`);
    }
  };

  const isInitialSuperAdmin = user?.email?.toLowerCase() === 'ipempr.site@gmail.com';
  const isUserAdmin = isLocalMode || isInitialSuperAdmin || currentUserProfile?.role === 'ADMIN';
  const isUserOperator = currentUserProfile?.role === 'OPERADOR';
  const isUserViewer = currentUserProfile?.role === 'VISUALIZADOR';

  const canEditData = isUserAdmin || isUserOperator;
  const canDeleteBatch = isUserAdmin;
  const canManageConfigs = isUserAdmin;

  const pendingUsersCount = useMemo(() => {
    return allUsers.filter(u => u.status === 'PENDING').length;
  }, [allUsers]);

  // Data Fetching
  useEffect(() => {
    if (!user) return;

    if (isLocalMode) {
      // Offline Local Mode
      const savedBatches = localStorage.getItem('lotes_batches');
      const savedPacs = localStorage.getItem('lotes_pacs');
      const savedCollabs = localStorage.getItem('lotes_collaborators');
      const savedStatuses = localStorage.getItem('lotes_statuses');

      let initialBatches: Batch[] = [];
      let initialPacs: ConfigItem[] = [];
      let initialCollabs: ConfigItem[] = [];
      let initialStatuses: ConfigItem[] = [];

      if (savedPacs) {
        initialPacs = JSON.parse(savedPacs);
      } else {
        initialPacs = [
          { id: 'p1', name: 'PAC 01 - Araucária' },
          { id: 'p2', name: 'PAC 02 - Cascavel' },
          { id: 'p3', name: 'PAC 03 - Curitiba' },
          { id: 'p4', name: 'PAC 04 - Foz do Iguaçu' },
          { id: 'p5', name: 'PAC 05 - Londrina' },
          { id: 'p6', name: 'PAC 06 - Maringá' },
          { id: 'p7', name: 'PAC 07 - Ponta Grossa' }
        ];
        localStorage.setItem('lotes_pacs', JSON.stringify(initialPacs));
      }

      if (savedCollabs) {
        initialCollabs = JSON.parse(savedCollabs);
      } else {
        initialCollabs = [
          { id: 'c1', name: 'Ana Souza' },
          { id: 'c2', name: 'Carlos Lima' },
          { id: 'c3', name: 'Gabriel Ramos' },
          { id: 'c4', name: 'Mariana Santos' },
          { id: 'c5', name: 'Paulo Henrique' },
          { id: 'c6', name: 'Renata Costa' }
        ];
        localStorage.setItem('lotes_collaborators', JSON.stringify(initialCollabs));
      }

      if (savedStatuses) {
        initialStatuses = JSON.parse(savedStatuses);
      } else {
        initialStatuses = [
          { id: 's1', name: 'ABERTO' },
          { id: 's2', name: 'ALERTA' },
          { id: 's3', name: 'ATRASO' },
          { id: 's4', name: 'EM ANDAMENTO' },
          { id: 's5', name: 'FINALIZADO' }
        ];
        localStorage.setItem('lotes_statuses', JSON.stringify(initialStatuses));
      }

      if (savedBatches) {
        const raw = JSON.parse(savedBatches);
        initialBatches = raw.map((b: any) => ({
          ...b,
          periodoInicial: parseLocalTimestamp(b.periodoInicial),
          periodoFinal: parseLocalTimestamp(b.periodoFinal),
          recebidoEm: parseLocalTimestamp(b.recebidoEm),
          lidoEm: parseLocalTimestamp(b.lidoEm),
          conferidoEm: parseLocalTimestamp(b.conferidoEm)
        }));
      } else {
        initialBatches = [
          {
            id: 'b1',
            pac: 'PAC 02 - Cascavel',
            numEnsaios: 15,
            status: 'FINALIZADO',
            recebidoPor: 'Ana Souza',
            recebidoEm: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 15),
            lidoPor: 'Ana Souza',
            lidoEm: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 12),
            conferidoPor: 'Carlos Lima',
            conferidoEm: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 10),
            periodoInicial: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 25),
            periodoFinal: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 15)
          },
          {
            id: 'b2',
            pac: 'PAC 01 - Araucária',
            numEnsaios: 8,
            status: 'EM ANDAMENTO',
            recebidoPor: 'Carlos Lima',
            recebidoEm: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 5),
            periodoInicial: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 10),
            periodoFinal: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 5)
          },
          {
            id: 'b3',
            pac: 'PAC 03 - Curitiba',
            numEnsaios: 12,
            status: 'ABERTO',
            recebidoPor: 'Gabriel Ramos',
            recebidoEm: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 2),
            periodoInicial: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 2),
            periodoFinal: LocalTimestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 2)
          }
        ];
        localStorage.setItem('lotes_batches', JSON.stringify(initialBatches));
      }

      const savedNonConforConfigs = localStorage.getItem('lotes_non_conformities_configs');
      const savedNonConforRecords = localStorage.getItem('lotes_lote_nao_conformidades');

      let initialNonConforConfigs: ConfigItem[] = [];
      let initialNonConforRecords: any[] = [];

      if (savedNonConforConfigs) {
        initialNonConforConfigs = JSON.parse(savedNonConforConfigs);
      } else {
        initialNonConforConfigs = [
          { id: 'nc1', name: 'Placa não cadastrada' },
          { id: 'nc2', name: 'Documento ilegível' },
          { id: 'nc3', name: 'Divergência de veículo' },
          { id: 'nc4', name: 'Ensaio danificado' },
          { id: 'nc5', name: 'Lacre rompido' }
        ];
        localStorage.setItem('lotes_non_conformities_configs', JSON.stringify(initialNonConforConfigs));
      }

      if (savedNonConforRecords) {
        initialNonConforRecords = JSON.parse(savedNonConforRecords);
      } else {
        initialNonConforRecords = [];
        localStorage.setItem('lotes_lote_nao_conformidades', JSON.stringify(initialNonConforRecords));
      }

      // Load local framings (enquadramentos)
      const savedFramings = localStorage.getItem('lotes_framings');
      let initialFramings: any[] = [];
      if (savedFramings) {
        initialFramings = JSON.parse(savedFramings);
      } else {
        initialFramings = [
          { id: 'f1', number: 'Art. 12', description: 'Peso líquido abaixo do limite legal tolerado' },
          { id: 'f2', number: 'Art. 18 Sec. I', description: 'Falta de lacre de segurança' },
          { id: 'f3', number: 'Art. 22', description: 'Divergência grosseira no diâmetro nominal' }
        ];
        localStorage.setItem('lotes_framings', JSON.stringify(initialFramings));
      }

      // Load local notification types
      const savedNotificationTypes = localStorage.getItem('lotes_notification_types');
      let initialNotificationTypes: ConfigItem[] = [];
      const defaultAlertaType = { 
        id: 'nt0', 
        name: 'ALERTA 1 - ORIENTAÇÃO',
        rule: {
          active: true,
          validadeMeses: 12,
          criterioA_ativo: true,
          criterioA_ncId: '',
          criterioA_limite: 0,
          criterioB_ativo: false,
          criterioB_ncId: '',
          criterioB_limite: 0,
          operadorLogico: 'OU' as const,
          limiteNotificacoes: 1,
          proximoNivel_typeId: 'nt1',
          regraAtraso_ativa: true,
          regraAtraso_ncId: '',
          regraAtraso_limiteRepeticoes: 4
        }
      };

      if (savedNotificationTypes) {
        initialNotificationTypes = JSON.parse(savedNotificationTypes);
        // Ensure "ALERTA 1 - ORIENTAÇÃO" type exists as first option
        const existingAlerta = initialNotificationTypes.find(t => t.id === 'nt0' || t.name === 'ALERTA 1 - ORIENTAÇÃO');
        if (!existingAlerta) {
          initialNotificationTypes.unshift(defaultAlertaType);
          localStorage.setItem('lotes_notification_types', JSON.stringify(initialNotificationTypes));
        } else if (existingAlerta.rule && (existingAlerta.rule.regraAtraso_limiteRepeticoes ?? 0) < 4) {
          existingAlerta.rule.regraAtraso_limiteRepeticoes = 4;
          localStorage.setItem('lotes_notification_types', JSON.stringify(initialNotificationTypes));
        }
      } else {
        initialNotificationTypes = [
          defaultAlertaType,
          { 
            id: 'nt1', 
            name: 'Notificação de Irregularidade',
            rule: {
              active: true,
              validadeMeses: 12,
              criterioA_ativo: true,
              criterioA_ncId: '',
              criterioA_limite: 5,
              criterioB_ativo: true,
              criterioB_ncId: '',
              criterioB_limite: 10,
              operadorLogico: 'OU',
              limiteNotificacoes: 2,
              proximoNivel_typeId: 'nt2',
              regraAtraso_ativa: false,
              regraAtraso_ncId: '',
              regraAtraso_limiteRepeticoes: 2
            }
          },
          { 
            id: 'nt2', 
            name: 'Termo de Ocorrência',
            rule: {
              active: true,
              validadeMeses: 6,
              criterioA_ativo: true,
              criterioA_ncId: '',
              criterioA_limite: 10,
              criterioB_ativo: true,
              criterioB_ncId: '',
              criterioB_limite: 15,
              operadorLogico: 'E',
              limiteNotificacoes: 1,
              proximoNivel_typeId: 'nt3',
              regraAtraso_ativa: false,
              regraAtraso_ncId: '',
              regraAtraso_limiteRepeticoes: 2
            }
          },
          { 
            id: 'nt3', 
            name: 'Auto de Infração',
            rule: {
              active: true,
              validadeMeses: 6,
              criterioA_ativo: true,
              criterioA_ncId: '',
              criterioA_limite: 15,
              criterioB_ativo: false,
              criterioB_ncId: '',
              criterioB_limite: 20,
              operadorLogico: 'OU',
              limiteNotificacoes: 3,
              proximoNivel_typeId: '',
              regraAtraso_ativa: false,
              regraAtraso_ncId: '',
              regraAtraso_limiteRepeticoes: 2
            }
          }
        ];
        localStorage.setItem('lotes_notification_types', JSON.stringify(initialNotificationTypes));
      }

      // Load local generated notifications
      const savedGeneratedNotifications = localStorage.getItem('lotes_notifications');
      let initialGeneratedNotifications: any[] = [];
      if (savedGeneratedNotifications) {
        initialGeneratedNotifications = JSON.parse(savedGeneratedNotifications);
      } else {
        initialGeneratedNotifications = [];
        localStorage.setItem('lotes_notifications', JSON.stringify(initialGeneratedNotifications));
      }

      setPacs(initialPacs.sort((a, b) => a.name.localeCompare(b.name)));
      setCollaborators(initialCollabs.sort((a, b) => a.name.localeCompare(b.name)));
      setStatuses(initialStatuses.sort((a, b) => a.name.localeCompare(b.name)));
      setNonConformitiesConfigs(initialNonConforConfigs.sort((a, b) => a.name.localeCompare(b.name)));
      setFramings(initialFramings.sort((a, b) => a.number ? a.number.localeCompare(b.number) : 0));
      setNonConformityRecords(initialNonConforRecords);
      setNotificationTypes(initialNotificationTypes.sort((a, b) => a.name.localeCompare(b.name)));
      setGeneratedNotifications(initialGeneratedNotifications);
      setBatches(initialBatches);
      return;
    }

    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          setError("Erro de conexão com o Firebase. Verifique as regras de segurança.");
        }
      }
    };
    testConnection();

    const unsubBatches = onSnapshot(
      query(collection(db, 'batches'), orderBy('recebidoEm', 'desc')),
      (snapshot) => setBatches(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Batch))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'batches')
    );

    const unsubPacs = onSnapshot(
      query(collection(db, 'pacs'), orderBy('name')),
      (snapshot) => setPacs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ConfigItem))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'pacs')
    );

    const unsubCollabs = onSnapshot(
      query(collection(db, 'collaborators'), orderBy('name')),
      (snapshot) => setCollaborators(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ConfigItem))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'collaborators')
    );

    const unsubStatuses = onSnapshot(
      query(collection(db, 'statuses'), orderBy('name')),
      (snapshot) => setStatuses(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ConfigItem))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'statuses')
    );

    const unsubNonConforConfigs = onSnapshot(
      query(collection(db, 'non_conformities_configs'), orderBy('name')),
      (snapshot) => setNonConformitiesConfigs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ConfigItem))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'non_conformities_configs')
    );

    const unsubNonConforRecords = onSnapshot(
      collection(db, 'lote_nao_conformidades'),
      (snapshot) => setNonConformityRecords(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'lote_nao_conformidades')
    );

    const unsubNotificationTypes = onSnapshot(
      query(collection(db, 'notification_types'), orderBy('name')),
      (snapshot) => setNotificationTypes(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ConfigItem))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'notification_types')
    );

    const unsubFramings = onSnapshot(
      collection(db, 'framings'),
      (snapshot) => setFramings(snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.number || '').localeCompare(b.number || ''))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'framings')
    );

    const unsubNotifications = onSnapshot(
      collection(db, 'notifications'),
      (snapshot) => setGeneratedNotifications(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    const unsubLogo = onSnapshot(
      doc(db, 'configs', 'branding'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data) {
            if (data.logoUrl !== undefined) {
              setLogoUrl(data.logoUrl);
              if (data.logoUrl) {
                localStorage.setItem('lotes_logoUrl', data.logoUrl);
              } else {
                localStorage.removeItem('lotes_logoUrl');
              }
            }
            if (data.signatures !== undefined) {
              setSignatures(data.signatures);
              localStorage.setItem('lotes_signatures', JSON.stringify(data.signatures));
            }
          }
        }
      },
      (err) => console.log('Firestore unsubLogo warn:', err)
    );

    const unsubSecurity = onSnapshot(
      doc(db, 'configs', 'security'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && data.password) {
            setConfigPassword(data.password);
            localStorage.setItem('lotes_config_password', data.password);
          }
        }
      },
      (err) => console.log('Firestore unsubSecurity warn:', err)
    );

    const unsubDeadlines = onSnapshot(
      doc(db, 'configs', 'deadlines'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && Array.isArray(data.items)) {
            setDeadlineExtensions(data.items);
            setGlobalDeadlineExtensions(data.items);
            localStorage.setItem('lotes_deadline_extensions', JSON.stringify(data.items));
          }
        }
      },
      (err) => console.log('Firestore unsubDeadlines warn:', err)
    );

    return () => {
      unsubBatches();
      unsubPacs();
      unsubCollabs();
      unsubStatuses();
      unsubNonConforConfigs();
      unsubNonConforRecords();
      unsubNotificationTypes();
      unsubFramings();
      unsubNotifications();
      unsubLogo();
      unsubSecurity();
      unsubDeadlines();
    };
  }, [user, isLocalMode]);

  // Autocorrect batches where recebidoPor is blank or "LUIZ", replacing with "LUIZ CARLOS"
  useEffect(() => {
    if (!user || batches.length === 0) return;
    
    const batchesNeedFix = batches.filter(b => {
      const rec = b.recebidoPor ? b.recebidoPor.trim().toUpperCase() : '';
      return rec === '' || rec === 'LUIZ';
    });
    
    if (batchesNeedFix.length === 0) return;
    
    const runFix = async () => {
      if (isLocalMode) {
        const updated = batches.map(b => {
          const rec = b.recebidoPor ? b.recebidoPor.trim().toUpperCase() : '';
          if (rec === '' || rec === 'LUIZ') {
            return { ...b, recebidoPor: 'LUIZ CARLOS' };
          }
          return b;
        });
        setBatches(updated);
        localStorage.setItem('lotes_batches', JSON.stringify(updated));
      } else {
        try {
          const batchUpdate = writeBatch(db);
          batchesNeedFix.forEach(b => {
            const docRef = doc(db, 'batches', b.id);
            batchUpdate.update(docRef, { recebidoPor: 'LUIZ CARLOS' });
          });
          await batchUpdate.commit();
        } catch (err) {
          console.error("Erro ao corrigir recebidoPor no Firestore:", err);
        }
      }
    };
    
    runFix();
  }, [user, batches, isLocalMode]);

  // Autocorrect batches and PAC configs where pac is "CALIXTO", replacing with "JOSÉ CALIXTO"
  useEffect(() => {
    if (!user) return;

    // 1. Check batches
    if (batches.length > 0) {
      const batchesNeedCalixtoFix = batches.filter(b => {
        const p = b.pac ? b.pac.trim().toUpperCase() : '';
        return p === 'CALIXTO' || p === 'PAC CALIXTO' || (p.includes('CALIXTO') && !p.includes('JOSÉ') && !p.includes('JOSE'));
      });

      if (batchesNeedCalixtoFix.length > 0) {
        const runCalixtoBatchFix = async () => {
          if (isLocalMode) {
            const updated = batches.map(b => {
              const p = b.pac ? b.pac.trim().toUpperCase() : '';
              if (p === 'CALIXTO' || p === 'PAC CALIXTO' || (p.includes('CALIXTO') && !p.includes('JOSÉ') && !p.includes('JOSE'))) {
                return { ...b, pac: 'JOSÉ CALIXTO' };
              }
              return b;
            });
            setBatches(updated);
            localStorage.setItem('lotes_batches', JSON.stringify(updated));
          } else {
            try {
              const batchUpdate = writeBatch(db);
              batchesNeedCalixtoFix.forEach(b => {
                const docRef = doc(db, 'batches', b.id);
                batchUpdate.update(docRef, { pac: 'JOSÉ CALIXTO' });
              });
              await batchUpdate.commit();
            } catch (err) {
              console.error("Erro ao corrigir PAC CALIXTO em batches no Firestore:", err);
            }
          }
        };
        runCalixtoBatchFix();
      }
    }

    // 2. Check PACs configuration list
    if (pacs.length > 0) {
      const pacsNeedFix = pacs.filter(p => {
        const nameUpper = p.name ? p.name.trim().toUpperCase() : '';
        return nameUpper === 'CALIXTO' || nameUpper === 'PAC CALIXTO' || (nameUpper.includes('CALIXTO') && !nameUpper.includes('JOSÉ') && !nameUpper.includes('JOSE'));
      });

      if (pacsNeedFix.length > 0) {
        const runCalixtoPacConfigFix = async () => {
          if (isLocalMode) {
            const updatedPacs = pacs.map(p => {
              const nameUpper = p.name ? p.name.trim().toUpperCase() : '';
              if (nameUpper === 'CALIXTO' || nameUpper === 'PAC CALIXTO' || (nameUpper.includes('CALIXTO') && !nameUpper.includes('JOSÉ') && !nameUpper.includes('JOSE'))) {
                return { ...p, name: 'JOSÉ CALIXTO' };
              }
              return p;
            });
            setPacs(updatedPacs);
            localStorage.setItem('lotes_pacs', JSON.stringify(updatedPacs));
          } else {
            try {
              const batchUpdate = writeBatch(db);
              pacsNeedFix.forEach(p => {
                const docRef = doc(db, 'pacs', p.id);
                batchUpdate.update(docRef, { name: 'JOSÉ CALIXTO' });
              });
              await batchUpdate.commit();
            } catch (err) {
              console.error("Erro ao corrigir PAC CALIXTO em pacs no Firestore:", err);
            }
          }
        };
        runCalixtoPacConfigFix();
      }
    }
  }, [user, batches, pacs, isLocalMode]);

  // Filtered Batches
  const filteredBatches = useMemo(() => {
    const searchLower = searchTerm.toLowerCase().trim();
    const startDateObj = dashStartDate ? startOfDay(parseLocalDate(dashStartDate)) : null;
    const endDateObj = dashEndDate ? startOfDay(parseLocalDate(dashEndDate)) : null;
    const now = new Date();

    return batches.filter(b => {
      const matchesSearch = !searchLower ||
        (b.pac && b.pac.toLowerCase().includes(searchLower)) ||
        (b.status && b.status.toLowerCase().includes(searchLower)) ||
        (b.recebidoPor && b.recebidoPor.toLowerCase().includes(searchLower));
      
      if (!matchesSearch) return false;

      const isFinished = !!b.conferidoPor && b.conferidoPor.trim() !== '';
      const pacDelivery = evaluatePacDeliveryDeadline(b.periodoInicial, b.recebidoEm, b.ensaioForaDoPrazo, deadlineExtensions);
      const periodoInicialDate = pacDelivery.pInicialDate;
      const deadline = pacDelivery.maxDeadlineDate; // 10 dias base + 7 dias Correios + ampliações de recesso/feriado
      // Regra Dashboard: sinalizar alerta/atraso SOMENTE quando passar da data de tolerância (deadline) e não estiver isento pelo checkbox
      const hasPassedToleranceDate = !pacDelivery.isExemptByCheckbox && (pacDelivery.isLate || (!isFinished && !pacDelivery.isDisregardedByRecess && deadline ? isAfter(startOfDay(now), deadline) : false));
      const isOverdue = hasPassedToleranceDate;
      const isWarning = hasPassedToleranceDate;

      // Status Filter Logic
      if (statusFilter === 'open' && isFinished) return false;
      if (statusFilter === 'finished' && !isFinished) return false;
      if (statusFilter === 'ATRASO' && !isOverdue) return false;
      if (statusFilter === 'ALERTA' && !isWarning) return false;
      if (statusFilter === 'EM DIA' && (hasPassedToleranceDate || isFinished)) return false;

      // Dashboard Period Filter
      const dateObj = isFinished 
        ? periodoInicialDate 
        : (toSafeDate(b.recebidoEm) || periodoInicialDate);

      if (dateObj) {
        if (startDateObj && dateObj < startDateObj) return false;
        if (endDateObj && startOfDay(dateObj) > endDateObj) return false;
      }

      return true;
    });
  }, [batches, searchTerm, statusFilter, dashStartDate, dashEndDate, deadlineExtensions]);

  // Statistics for Dashboard overview cards (respects the selected Dashboard period filter)
  const stats = useMemo(() => {
    let onTimeCount = 0;
    let lateCount = 0;
    let totalEnsaiosFinished = 0;
    let totalEnsaiosOpen = 0;
    let totalEnsaiosReceived = 0;

    const startDateObj = dashStartDate ? startOfDay(parseLocalDate(dashStartDate)) : null;
    const endDateObj = dashEndDate ? startOfDay(parseLocalDate(dashEndDate)) : null;

    batches.forEach(b => {
      const hasInformado = b.conferidoPor && b.conferidoPor.trim() !== '';
      const pacDelivery = evaluatePacDeliveryDeadline(b.periodoInicial, b.recebidoEm, b.ensaioForaDoPrazo);
      const periodoInicialDate = pacDelivery.pInicialDate;
      const recebidoEmDate = pacDelivery.recebidoEmDate;

      if (hasInformado) {
        // Check if finished batch is within dashboard period filter (using periodoInicial)
        let match = true;
        if (periodoInicialDate) {
          if (startDateObj && periodoInicialDate < startDateObj) match = false;
          if (endDateObj && startOfDay(periodoInicialDate) > endDateObj) match = false;
        }

        if (match) {
          totalEnsaiosFinished += (b.numEnsaios || 0);
          
          // On time vs Late (Regra PAC: 10 dias + 7 dias Correios = 17 dias da data inicial até o recebimento)
          if (pacDelivery.isLate) {
            lateCount++;
          } else {
            onTimeCount++;
          }
        }
      } else {
        // Check if open batch is within dashboard period filter (using recebidoEm)
        let matchOpen = true;
        const openDate = recebidoEmDate || periodoInicialDate;
        if (openDate) {
          if (startDateObj && openDate < startDateObj) matchOpen = false;
          if (endDateObj && startOfDay(openDate) > endDateObj) matchOpen = false;
        } else {
          matchOpen = false;
        }

        if (matchOpen) {
          totalEnsaiosOpen += (b.numEnsaios || 0);
        }
      }

      // Check if batch is within dashboard period filter using recebidoEm and has recebidoPor filled
      let matchReceived = true;
      if (recebidoEmDate) {
        if (startDateObj && recebidoEmDate < startDateObj) matchReceived = false;
        if (endDateObj && startOfDay(recebidoEmDate) > endDateObj) matchReceived = false;
      }

      if (matchReceived && b.recebidoPor && b.recebidoPor.trim() !== '') {
        totalEnsaiosReceived += (b.numEnsaios || 0);
      }
    });

    const totalFinished = onTimeCount + lateCount;

    return {
      onTimeCount,
      lateCount,
      totalFinished,
      totalEnsaiosFinished,
      totalEnsaiosOpen,
      totalEnsaiosReceived
    };
  }, [batches, dashStartDate, dashEndDate]);

  const handleDeleteBatch = async (id: string) => {
    if (isLocalMode) {
      const updated = batches.filter(b => b.id !== id);
      setBatches(updated);
      localStorage.setItem('lotes_batches', JSON.stringify(updated));
      setBatchToDelete(null);
      return;
    }
    try {
      await deleteDoc(doc(db, 'batches', id));
      setBatchToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `batches/${id}`);
    }
  };

  const handleUpdateConfig = async (type: string, id: string, name: string, extraFields?: any) => {
    if (isLocalMode) {
      if (type === 'pacs') {
        const updated = pacs.map(p => p.id === id ? { ...p, name, ...(extraFields || {}) } : p).sort((a, b) => a.name.localeCompare(b.name));
        setPacs(updated);
        localStorage.setItem('lotes_pacs', JSON.stringify(updated));
      } else if (type === 'collaborators') {
        const updated = collaborators.map(c => c.id === id ? { ...c, name } : c).sort((a, b) => a.name.localeCompare(b.name));
        setCollaborators(updated);
        localStorage.setItem('lotes_collaborators', JSON.stringify(updated));
      } else if (type === 'statuses') {
        const updated = statuses.map(s => s.id === id ? { ...s, name } : s).sort((a, b) => a.name.localeCompare(b.name));
        setStatuses(updated);
        localStorage.setItem('lotes_statuses', JSON.stringify(updated));
      } else if (type === 'non_conformities_configs') {
        const updated = nonConformitiesConfigs.map(s => s.id === id ? { ...s, name, ...(extraFields || {}) } : s).sort((a, b) => a.name.localeCompare(b.name));
        setNonConformitiesConfigs(updated);
        localStorage.setItem('lotes_non_conformities_configs', JSON.stringify(updated));
      } else if (type === 'notification_types') {
        const updated = notificationTypes.map(s => s.id === id ? { ...s, name } : s).sort((a, b) => a.name.localeCompare(b.name));
        setNotificationTypes(updated);
        localStorage.setItem('lotes_notification_types', JSON.stringify(updated));
      }
      return;
    }
    try {
      await updateDoc(doc(db, type, id), { name, ...(extraFields || {}) });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${type}/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#5A5A40]"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0] p-4">
        <div className="max-w-md w-full bg-white rounded-[32px] p-8 sm:p-12 shadow-xl text-center">
          <h1 className="text-4xl font-display font-bold tracking-tight mb-4 text-[#1a1a1a]">Gestão de Lotes</h1>
          <p className="text-[#5A5A40] mb-8 leading-relaxed text-sm">
            Gerencie e acompanhe lotes de ensaios de modo rápido, prático e persistente.
          </p>

          {googleLoginError && (() => {
            const parsed = parseAuthError(googleLoginError);
            return (
              <div className="mb-6 bg-red-50 border border-red-200 text-left p-5 rounded-2.5xl relative">
                <button 
                  onClick={() => setGoogleLoginError(null)} 
                  className="absolute top-4 right-4 text-[#5a5a40] hover:text-red-700 transition cursor-pointer"
                  title="Fechar"
                >
                  <X size={16} />
                </button>
                <div className="flex gap-2.5 items-start text-red-800">
                  <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-sm leading-snug">{parsed.title}</h3>
                    <p className="text-xs mt-1 text-red-700/90 leading-normal">{parsed.message}</p>
                  </div>
                </div>
                {parsed.actionHtml && (
                  <div dangerouslySetInnerHTML={{ __html: parsed.actionHtml }} />
                )}
              </div>
            );
          })()}

          <div className="mb-6 p-4 rounded-2xl bg-amber-50/50 border border-amber-200/60 text-left space-y-2">
            <div className="flex items-start gap-2 text-amber-850">
              <Sparkles size={16} className="shrink-0 mt-0.5 text-amber-600" />
              <span className="text-xs font-bold uppercase tracking-wider">Aviso de Segurança e Navegação</span>
            </div>
            <p className="text-[11px] text-amber-900/90 leading-relaxed">
              Como o aplicativo está sendo executado dentro do <strong>painel de visualização (iFrame) do AI Studio</strong>, o Google bloqueia cookies de terceiros e janelas popup por segurança. 
            </p>
            <div className="text-[11px] text-amber-900/95 font-medium space-y-1">
              <p>💡 <strong>Como resolver para usar a Nuvem:</strong></p>
              <ul className="list-disc list-inside pl-1 space-y-0.5">
                <li>Clique no botão <strong>"Abrir em nova aba" (Open in new tab)</strong> no canto superior direito do painel de visualização.</li>
                <li>Na nova aba, clique em <strong>"Entrar com Google"</strong>. Lá funcionará perfeitamente!</li>
              </ul>
            </div>
          </div>

          <button 
            onClick={handleLogin}
            className="w-full bg-[#5A5A40] text-white rounded-full py-4 font-semibold hover:bg-[#4a4a30] transition-colors flex items-center justify-center gap-3 shadow-md mb-4 cursor-pointer"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5 bg-white rounded-full p-0.5" alt="Google" />
            Entrar com Google
          </button>

          <div className="relative flex py-4 items-center">
            <div className="flex-grow border-t border-[#e5e5e0]"></div>
            <span className="flex-shrink mx-4 text-[10px] text-[#5A5A40] opacity-50 uppercase font-bold tracking-wider">Ou</span>
            <div className="flex-grow border-t border-[#e5e5e0]"></div>
          </div>

          <button 
            onClick={handleLocalLogin}
            className="w-full bg-white border border-[#5A5A40]/35 text-[#5A5A40] rounded-full py-4 font-semibold hover:bg-[#f0f0e5] transition-colors flex items-center justify-center gap-3 cursor-pointer shadow-sm"
          >
            Entrar em Modo Local (Demonstração)
          </button>

          <p className="text-[11px] text-[#5A5A40]/60 mt-6 leading-relaxed bg-[#f5f5f0] p-4 rounded-2xl border border-[#e5e5e0] text-left">
            🎯 <strong>Modo Local Offline:</strong> Permite criar e editar lotes de ensaios, gerar notificações oficiais em PDF, gerenciar modelos de ofício e visualizar estatísticas completas, salvando tudo diretamente no armazenamento do seu navegador.
          </p>
        </div>
      </div>
    );
  }

  if (!isLocalMode && userProfileLoading) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 size={40} className="animate-spin text-[#5A5A40] mb-4" />
        <h3 className="text-lg font-bold text-gray-800">Verificando autorizações de acesso...</h3>
        <p className="text-xs text-[#5A5A40]/70 mt-1">Carregando perfil e permissões para {user.email}</p>
      </div>
    );
  }

  if (!isLocalMode && currentUserProfile?.status === 'PENDING') {
    return (
      <PendingApprovalScreen 
        user={user} 
        onRefresh={async () => {
          const profileRef = doc(db, 'user_profiles', user.uid);
          const snap = await getDocFromServer(profileRef);
          if (snap.exists()) {
            setCurrentUserProfile(snap.data() as UserProfile);
          }
        }} 
        onLogout={handleLogout} 
      />
    );
  }

  if (!isLocalMode && currentUserProfile?.status === 'REJECTED') {
    return (
      <AccessDeniedScreen 
        user={user} 
        onLogout={handleLogout} 
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1a1a1a] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-[#e5e5e0] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-display font-bold tracking-tight">Lotes Ensaio</h1>
            <nav className="flex gap-1">
              <button 
                onClick={() => setActiveTab('dashboard')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
                  activeTab === 'dashboard' ? "bg-[#5A5A40] text-white" : "text-[#5A5A40] hover:bg-[#f0f0e5]"
                )}
              >
                Dashboard
              </button>
              <button 
                onClick={() => setActiveTab('stats')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
                  activeTab === 'stats' ? "bg-[#5A5A40] text-white" : "text-[#5A5A40] hover:bg-[#f0f0e5]"
                )}
              >
                Estatísticas
              </button>
              <button 
                onClick={() => setActiveTab('notifications')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
                  activeTab === 'notifications' ? "bg-[#5A5A40] text-white" : "text-[#5A5A40] hover:bg-[#f0f0e5]"
                )}
              >
                Notificações
              </button>
              <button 
                onClick={() => setActiveTab('config')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
                  activeTab === 'config' ? "bg-[#5A5A40] text-white" : "text-[#5A5A40] hover:bg-[#f0f0e5]"
                )}
              >
                Configurações
              </button>
              {isUserAdmin && (
                <button 
                  onClick={() => setActiveTab('users')}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 relative",
                    activeTab === 'users' ? "bg-[#5A5A40] text-white" : "text-[#5A5A40] hover:bg-[#f0f0e5]"
                  )}
                >
                  <ShieldCheck size={16} />
                  <span>Acessos</span>
                  {pendingUsersCount > 0 && (
                    <span className="bg-amber-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                      {pendingUsersCount}
                    </span>
                  )}
                </button>
              )}
              <button 
                onClick={() => setActiveTab('tutorial')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5",
                  activeTab === 'tutorial' ? "bg-[#5A5A40] text-white" : "text-[#5A5A40] hover:bg-[#f0f0e5]"
                )}
              >
                <BookOpen size={14} className="mt-0.5" /> Tutorial do Sistema
              </button>
            </nav>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <div className="flex items-center justify-end gap-2">
                <p className="text-sm font-medium">{user.displayName}</p>
                {currentUserProfile?.role && (
                  <span className={cn(
                    "text-[9px] font-extrabold px-2 py-0.5 rounded-full border uppercase tracking-wider",
                    currentUserProfile.role === 'ADMIN' ? "bg-purple-100 text-purple-800 border-purple-200" :
                    currentUserProfile.role === 'OPERADOR' ? "bg-blue-100 text-blue-800 border-blue-200" :
                    "bg-emerald-100 text-emerald-800 border-emerald-200"
                  )}>
                    {currentUserProfile.role}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <p className="text-xs text-[#5A5A40]">{user.email}</p>
                {isLocalMode ? (
                  <button 
                    onClick={() => {
                      localStorage.removeItem('lotes_isLocalMode');
                      localStorage.removeItem('lotes_quota_exceeded_fallback');
                      window.location.reload();
                    }}
                    className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-full hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition cursor-pointer"
                    title="Clique para reativar o banco de dados na Nuvem"
                  >
                    ⚡ Modo Local (Mudar p/ Nuvem)
                  </button>
                ) : (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full">
                    ☁️ Sincronizado com a Nuvem
                  </span>
                )}
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-[#5A5A40] hover:bg-[#f0f0e5] rounded-full transition-colors"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {error && (() => {
          const isQuota = (error.toLowerCase().includes('quota') || error.toLowerCase().includes('exceeded') || error.toLowerCase().includes('cota') || error.toLowerCase().includes('limite')) && !error.toLowerCase().includes('permission');
          return (
            <div className={cn(
              "mb-6 rounded-[24px] p-6 shadow-md border",
              isQuota ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-red-50 border-red-200 text-red-900"
            )}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <AlertCircle size={22} className={cn("shrink-0 mt-0.5", isQuota ? "text-amber-600" : "text-red-600")} />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold uppercase tracking-wider">
                      {isQuota ? "Uso da Cota Diária do Banco de Dados Cloud Excedida" : "Erro de Conexão / Operação no Servidor"}
                    </h3>
                    <p className="text-xs leading-relaxed max-w-4xl">
                      {isQuota ? (
                        <>
                          O servidor do banco de dados na nuvem (Firestore) atingiu os limites diários do plano gratuito para este projeto. 
                          Para que você não perca seu progresso e continue utilizando todas as funcionalidades normalmente, você pode reativar o <strong>Modo de Armazenamento Local</strong> de backup imediato. Seus dados serão mantidos de forma segura no seu navegador.
                        </>
                      ) : (
                        <>
                          Ocorreu um problema ao conectar ou sincronizar as informações com a nuvem. Você pode continuar trabalhando de forma offline e segura mudando para o Modo de Armazenamento Local.
                        </>
                      )}
                    </p>
                    <p className={cn("text-[10px] leading-normal mt-1 border-t pt-1 font-mono", isQuota ? "text-amber-700/75 border-amber-200/50" : "text-red-700/75 border-red-200/50")}>
                      Detalhes técnicos: {error}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 self-end md:self-center shrink-0">
                  <button
                    onClick={enableLocalMode}
                    className={cn(
                      "px-4 py-2 text-white font-bold text-xs rounded-full transition-colors shadow-md flex items-center gap-1.5 cursor-pointer",
                      isQuota ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"
                    )}
                  >
                    <Sparkles size={13} className="animate-pulse" /> Ativar Modo Local Inteligente
                  </button>
                  <button 
                    onClick={() => setError(null)} 
                    className="p-2 hover:bg-black/5 rounded-full transition-colors"
                    title="Ignorar"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {quotaFallbackNotice && (
          <div className="mb-6 rounded-[24px] p-6 bg-amber-50 border border-amber-200 text-amber-900 shadow-md">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <Sparkles size={22} className="shrink-0 mt-0.5 text-amber-600 animate-pulse" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-amber-850">
                    Modo Local de Segurança Ativado Automaticamente
                  </h3>
                  <p className="text-xs leading-relaxed max-w-4xl text-amber-900/90">
                    O servidor de banco de dados na nuvem (Firestore) atingiu os limites diários do plano gratuito. Para garantir que seu trabalho continue sem qualquer interrupção, o sistema <strong>ativou automaticamente o Modo de Armazenamento Local</strong> de backup. Seus dados e configurações estão salvos localmente de forma 100% íntegra e segura no seu navegador.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 self-end md:self-center shrink-0">
                <button 
                  onClick={() => {
                    localStorage.removeItem('lotes_quota_exceeded_fallback');
                    localStorage.removeItem('lotes_isLocalMode');
                    setQuotaFallbackNotice(false);
                    setIsLocalMode(false);
                    window.location.reload();
                  }} 
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-full transition-colors shadow-sm cursor-pointer"
                >
                  Reativar Nuvem (Firebase)
                </button>
                <button 
                  onClick={() => {
                    localStorage.removeItem('lotes_quota_exceeded_fallback');
                    setQuotaFallbackNotice(false);
                  }} 
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-full transition-colors shadow-sm cursor-pointer"
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <>
            {/* Filtro de Período do Dashboard */}
            <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] mb-8">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-[#5A5A40]">Filtro de Período de Produção</h3>
                    <span className="text-[10px] font-semibold px-2 py-0.5 bg-[#f0f0e5] text-[#5A5A40] rounded-full">
                      Exibindo {filteredBatches.length} de {batches.length} lotes
                    </span>
                  </div>
                  <p className="text-xs text-[#5A5A40]/60">Filtrando por data inicial do lote. O padrão é o <strong>Ano Vigente ({currentYearNum})</strong> para máxima velocidade.</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#5A5A40]/70">De:</span>
                    <input
                      type="date"
                      className="px-3 py-2 bg-[#f5f5f0] border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                      value={dashStartDate}
                      onChange={(e) => setDashStartDate(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#5A5A40]/70">Até:</span>
                    <input
                      type="date"
                      className="px-3 py-2 bg-[#f5f5f0] border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                      value={dashEndDate}
                      onChange={(e) => setDashEndDate(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setDashStartDate(defaultCurrentYearStart);
                        setDashEndDate(defaultCurrentYearEnd);
                      }}
                      className={`px-3 py-2 font-bold text-xs rounded-xl transition-all ${
                        dashStartDate === defaultCurrentYearStart && dashEndDate === defaultCurrentYearEnd
                          ? 'bg-[#5A5A40] text-white shadow-sm'
                          : 'bg-[#f0f0e5] text-[#5A5A40] hover:bg-[#e0e0d5]'
                      }`}
                      title="Ano Vigente"
                    >
                      Ano Vigente ({currentYearNum})
                    </button>
                    <button
                      onClick={() => {
                        setDashStartDate(defaultDashStart);
                        setDashEndDate(defaultDashEnd);
                      }}
                      className={`px-3 py-2 font-bold text-xs rounded-xl transition-all ${
                        dashStartDate === defaultDashStart && dashEndDate === defaultDashEnd
                          ? 'bg-[#5A5A40] text-white shadow-sm'
                          : 'bg-[#f0f0e5] text-[#5A5A40] hover:bg-[#e0e0d5]'
                      }`}
                      title="Mês Atual"
                    >
                      Este Mês
                    </button>
                    <button
                      onClick={() => {
                        const thirtyDaysAgo = format(addDays(new Date(), -30), 'yyyy-MM-dd');
                        const today = format(new Date(), 'yyyy-MM-dd');
                        setDashStartDate(thirtyDaysAgo);
                        setDashEndDate(today);
                      }}
                      className="px-3 py-2 bg-[#f0f0e5] font-bold text-[#5A5A40] text-xs rounded-xl hover:bg-[#e0e0d5] transition-all"
                      title="Últimos 30 Dias"
                    >
                      30 Dias
                    </button>
                    <button
                      onClick={() => {
                        setDashStartDate(`${currentYearNum - 1}-01-01`);
                        setDashEndDate(`${currentYearNum - 1}-12-31`);
                      }}
                      className="px-3 py-2 bg-[#f0f0e5] font-bold text-[#5A5A40] text-xs rounded-xl hover:bg-[#e0e0d5] transition-all"
                      title="Ano Passado"
                    >
                      {currentYearNum - 1}
                    </button>
                    <button
                      onClick={() => {
                        setDashStartDate('');
                        setDashEndDate('');
                      }}
                      className={`px-3 py-2 font-bold text-xs rounded-xl transition-all ${
                        !dashStartDate && !dashEndDate
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                      title="Mostrar todos os registros"
                    >
                      Todo Histórico
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
                  <Download size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-[#5A5A40] opacity-60">Total Recebido</p>
                  <p className="text-2xl font-bold">{stats.totalEnsaiosReceived}</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-600">
                  <Clock size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-[#5A5A40] opacity-60">Total em Aberto</p>
                  <p className="text-2xl font-bold">{stats.totalEnsaiosOpen}</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-[#5A5A40] opacity-60">Finalizados</p>
                  <p className="text-2xl font-bold">{stats.totalEnsaiosFinished}</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                  <TrendingUp size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-[#5A5A40] opacity-60">No Prazo</p>
                  <p className="text-2xl font-bold">
                    {stats.totalFinished > 0 ? Math.round((stats.onTimeCount / stats.totalFinished) * 100) : 0}%
                  </p>
                </div>
              </div>
            </div>

            {/* Dashboard Header */}
            <div className="flex flex-col md:flex-row gap-4 mb-8 items-center justify-between">
              <div className="flex flex-1 flex-col md:flex-row gap-4 w-full">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]" size={18} />
                  <input 
                    type="text" 
                    placeholder="Buscar por PAC, Status ou Colaborador..."
                    className="w-full pl-12 pr-4 py-3 bg-white border border-[#e5e5e0] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="relative w-full md:w-48">
                  <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]" size={18} />
                  <select 
                    className="w-full pl-12 pr-4 py-3 bg-white border border-[#e5e5e0] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 appearance-none"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="open">Em Aberto</option>
                    <option value="finished">Finalizados</option>
                    <option value="all">Todos os Lotes</option>
                    <option value="EM DIA">Em Dia (Aberto)</option>
                    <option value="ALERTA">Alerta (Aberto)</option>
                    <option value="ATRASO">Atrasado (Aberto)</option>
                  </select>
                </div>
              </div>
              {canEditData ? (
                <button 
                  onClick={() => {
                    setEditingBatch(null);
                    setIsModalOpen(true);
                  }}
                  className="w-full md:w-auto bg-[#5A5A40] text-white px-6 py-3 rounded-2xl font-medium hover:bg-[#4a4a30] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#5A5A40]/10 shrink-0 cursor-pointer"
                >
                  <Plus size={20} />
                  Receber Novo Lote
                </button>
              ) : (
                <span className="text-xs font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-4 py-3 rounded-2xl flex items-center gap-1.5 cursor-not-allowed">
                  <Lock size={14} /> Modo Leitura (Visualizador)
                </span>
              )}
            </div>

            {/* Batches Grid */}
            <div className="grid grid-cols-1 gap-4">
              {filteredBatches.slice(0, visibleBatchLimit).map((batch) => (
                <BatchCard 
                  key={batch.id} 
                  batch={batch} 
                  deadlineExtensions={deadlineExtensions}
                  canEdit={canEditData}
                  canDelete={canDeleteBatch}
                  onEdit={() => {
                    setEditingBatch(batch);
                    setIsModalOpen(true);
                  }}
                  onDelete={() => setBatchToDelete(batch.id)}
                />
              ))}
              {filteredBatches.length > visibleBatchLimit && (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 py-6 bg-white/60 rounded-[24px] border border-[#e5e5e0]">
                  <button
                    onClick={() => setVisibleBatchLimit(prev => prev + 30)}
                    className="px-6 py-3 bg-[#5A5A40] text-white font-medium text-xs rounded-xl hover:bg-[#4a4a30] transition-all shadow-md shadow-[#5A5A40]/10 flex items-center gap-2"
                  >
                    <span>Carregar Mais Lotes</span>
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px]">
                      +{Math.min(30, filteredBatches.length - visibleBatchLimit)} de {filteredBatches.length - visibleBatchLimit} restantes
                    </span>
                  </button>
                  <button
                    onClick={() => setVisibleBatchLimit(filteredBatches.length)}
                    className="px-4 py-3 bg-gray-100 text-gray-700 font-medium text-xs rounded-xl hover:bg-gray-200 transition-all"
                  >
                    Exibir Todos ({filteredBatches.length} lotes)
                  </button>
                </div>
              )}
              {filteredBatches.length === 0 && (
                <div className="text-center py-20 bg-white rounded-[32px] border border-dashed border-[#e5e5e0]">
                  <Clock className="mx-auto mb-4 text-[#5A5A40]/30" size={48} />
                  <p className="text-[#5A5A40]">Nenhum lote encontrado.</p>
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'stats' ? (
          <StatsPanel
            batches={batches}
            collaborators={collaborators}
            pacs={pacs}
            nonConformityRecords={nonConformityRecords}
            nonConformitiesConfigs={nonConformitiesConfigs}
            generatedNotifications={generatedNotifications}
            notificationTypes={notificationTypes}
            isLocalMode={isLocalMode}
          />
        ) : activeTab === 'notifications' ? (
          <NotificationsPanel 
            batches={batches}
            pacs={pacs}
            nonConformityRecords={nonConformityRecords}
            nonConformitiesConfigs={nonConformitiesConfigs}
            notificationTypes={notificationTypes}
            generatedNotifications={generatedNotifications}
            setGeneratedNotifications={setGeneratedNotifications}
            isLocalMode={isLocalMode}
            handleFirestoreError={handleFirestoreError}
            logoUrl={logoUrl}
            signatures={signatures}
          />
        ) : activeTab === 'config' ? (
          !isConfigUnlocked ? (
            <ConfigPasswordGate 
              correctPassword={configPassword}
              onUnlock={() => {
                setIsConfigUnlocked(true);
                localStorage.setItem('lotes_config_unlocked', 'true');
              }}
              onCancel={() => setActiveTab('dashboard')}
            />
          ) : (
            <ConfigPanel 
              pacs={pacs} 
              collaborators={collaborators} 
              statuses={statuses}
              nonConformitiesConfigs={nonConformitiesConfigs}
              nonConformityRecords={nonConformityRecords}
              notificationTypes={notificationTypes}
              framings={framings}
              setFramings={setFramings}
              handleFirestoreError={handleFirestoreError}
              onUpdate={handleUpdateConfig}
              setConfigToDelete={setConfigToDelete}
              isLocalMode={isLocalMode}
              batches={batches}
              setBatches={setBatches}
              setPacs={setPacs}
              setCollaborators={setCollaborators}
              setStatuses={setStatuses}
              setNonConformitiesConfigs={setNonConformitiesConfigs}
              setNotificationTypes={setNotificationTypes}
              logoUrl={logoUrl}
              saveLogoUrl={saveLogoUrl}
              signatures={signatures}
              saveSignatures={saveSignatures}
              configPassword={configPassword}
              saveConfigPassword={saveConfigPassword}
              deadlineExtensions={deadlineExtensions}
              saveDeadlineExtensions={saveDeadlineExtensions}
              isConfigUnlocked={isConfigUnlocked}
              setIsConfigUnlocked={setIsConfigUnlocked}
              setActiveTab={setActiveTab}
            />
          )
        ) : activeTab === 'users' ? (
          isUserAdmin ? (
            <UserManagementPanel 
              currentUser={user}
              currentUserProfile={currentUserProfile}
              allUsers={allUsers}
              isLocalMode={isLocalMode}
              onUpdateUserStatus={handleUpdateUserStatus}
              onAddPreApprovedUser={handleAddPreApprovedUser}
              onDeleteUserProfile={handleDeleteUserProfile}
            />
          ) : (
            <div className="bg-white p-12 rounded-[32px] border border-red-200 text-center space-y-4">
              <AlertCircle size={48} className="mx-auto text-red-500" />
              <h3 className="text-xl font-bold text-gray-900">Acesso Restrito</h3>
              <p className="text-sm text-gray-600">
                A gestão de usuários é exclusiva para contas com nível de permissão Administrador.
              </p>
            </div>
          )
        ) : (
          <SystemTutorial />
        )}
      </main>

      {/* Modals */}
        {isModalOpen && (
          <BatchModal 
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            batch={editingBatch}
            pacs={pacs}
            collaborators={collaborators}
            statuses={statuses}
            nonConformitiesConfigs={nonConformitiesConfigs}
            handleFirestoreError={handleFirestoreError}
            isLocalMode={isLocalMode}
            onSaveLocalBatch={(localBatch: any, batchNCs: any[]) => {
              let updated;
              let batchId = '';
              if (editingBatch) {
                batchId = editingBatch.id;
                updated = batches.map(b => b.id === editingBatch.id ? { ...b, ...localBatch, nonConformities: batchNCs } : b);
              } else {
                batchId = 'local-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
                updated = [{ ...localBatch, id: batchId, nonConformities: batchNCs }, ...batches];
              }
              updated.sort((a, b) => (toSafeDate(b.recebidoEm)?.getTime() || 0) - (toSafeDate(a.recebidoEm)?.getTime() || 0));
              setBatches(updated);
              localStorage.setItem('lotes_batches', JSON.stringify(updated));

              // Save lote_nao_conformidades in local storage
              const savedNCRecords = localStorage.getItem('lotes_lote_nao_conformidades');
              let ncRecords = savedNCRecords ? JSON.parse(savedNCRecords) : [];
              // Filter out old ones for this batch ID
              ncRecords = ncRecords.filter((nc: any) => nc.recebimento_lote_id !== batchId);
              // Map and add new ones
              const newNCObjects = batchNCs.map(item => ({
                id: item.id.startsWith('nc-') ? item.id : 'ncLocal-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
                recebimento_lote_id: batchId,
                nao_conformidade_id: item.nao_conformidade_id,
                pac_id: localBatch.pac,
                placas: item.placas
              }));
              const updatedNCs = [...ncRecords, ...newNCObjects];
              localStorage.setItem('lotes_lote_nao_conformidades', JSON.stringify(updatedNCs));
              setNonConformityRecords(updatedNCs);
            }}
          />
        )}

        {batchToDelete && (
          <ConfirmModal 
            title="Excluir Lote"
            message="Tem certeza que deseja excluir este lote? Esta ação não pode ser desfeita."
            onConfirm={() => handleDeleteBatch(batchToDelete)}
            onCancel={() => setBatchToDelete(null)}
          />
        )}

        {configToDelete && (
          <ConfirmModal 
            title="Excluir Item"
            message="Tem certeza que deseja excluir este item das configurações?"
            onConfirm={async () => {
              const { type, id } = configToDelete;
              if (isLocalMode) {
                if (type === 'pacs') {
                  const updated = pacs.filter(p => p.id !== id);
                  setPacs(updated);
                  localStorage.setItem('lotes_pacs', JSON.stringify(updated));
                } else if (type === 'collaborators') {
                  const updated = collaborators.filter(c => c.id !== id);
                  setCollaborators(updated);
                  localStorage.setItem('lotes_collaborators', JSON.stringify(updated));
                } else if (type === 'statuses') {
                  const updated = statuses.filter(s => s.id !== id);
                  setStatuses(updated);
                  localStorage.setItem('lotes_statuses', JSON.stringify(updated));
                } else if (type === 'non_conformities_configs') {
                  const updated = nonConformitiesConfigs.filter(s => s.id !== id);
                  setNonConformitiesConfigs(updated);
                  localStorage.setItem('lotes_non_conformities_configs', JSON.stringify(updated));
                } else if (type === 'notification_types') {
                  const updated = notificationTypes.filter(s => s.id !== id);
                  setNotificationTypes(updated);
                  localStorage.setItem('lotes_notification_types', JSON.stringify(updated));
                }
                setConfigToDelete(null);
                return;
              }
              try {
                await deleteDoc(doc(db, type, id));
                setConfigToDelete(null);
              } catch (err) {
                handleFirestoreError(err, OperationType.DELETE, `${type}/${id}`);
              }
            }}
            onCancel={() => setConfigToDelete(null)}
          />
        )}
      </div>
    );
}

function ConfirmModal({ title, message, onConfirm, onCancel }: any) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8 animate-in fade-in zoom-in duration-200">
        <h3 className="text-xl font-display font-bold tracking-tight mb-4">{title}</h3>
        <p className="text-[#5A5A40] mb-8">{message}</p>
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 px-6 py-3 rounded-2xl font-medium border border-[#e5e5e0] hover:bg-[#f5f5f0] transition-all"
          >
            Cancelar
          </button>
          <button 
            onClick={onConfirm}
            className="flex-1 px-6 py-3 bg-red-500 text-white rounded-2xl font-medium hover:bg-red-600 transition-all"
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchCard({ batch, deadlineExtensions, onEdit, onDelete, canEdit = true, canDelete = true }: any) {
  const formatDate = (ts?: any) => {
    const d = toSafeDate(ts);
    return d ? format(d, "dd/MM/yyyy HH:mm", { locale: ptBR }) : '-';
  };
  const formatPeriod = (ts?: any) => {
    const d = toSafeDate(ts);
    return d ? format(d, "dd/MM/yyyy", { locale: ptBR }) : '-';
  };

  // Deadline Logic (Regra PAC: 10 dias da data inicial + 7 dias Correios + ampliações de recesso/feriado)
  // No Dashboard, o sinal de ALERTA/ATRASO só aparece quando o lote passa da data de tolerância!
  const isFinished = !!batch.conferidoPor && batch.conferidoPor.trim() !== '';
  const pacDelivery = evaluatePacDeliveryDeadline(batch.periodoInicial, batch.recebidoEm, batch.ensaioForaDoPrazo, deadlineExtensions);
  const pInicialDate = pacDelivery.pInicialDate || new Date();
  const deadline = pacDelivery.maxDeadlineDate || addDays(startOfDay(pInicialDate), PRAZO_MAXIMO_ENTREGA_PAC_DIAS);
  const isPacLate = pacDelivery.isLate;
  const hasPassedToleranceDate = !pacDelivery.isExemptByCheckbox && (isPacLate || (!isFinished && !pacDelivery.isDisregardedByRecess && isAfter(startOfDay(new Date()), deadline)));
  const isOverdue = !isFinished && hasPassedToleranceDate;
  const isWarning = hasPassedToleranceDate;

  const dynamicStatus = isFinished
    ? 'FINALIZADO'
    : hasPassedToleranceDate
      ? 'ALERTA • FORA DO PRAZO'
      : batch.status;

  return (
    <div className={cn(
      "bg-white rounded-[24px] p-6 border transition-all group",
      isOverdue ? "border-red-200 bg-red-50/10" : 
      isPacLate ? "border-amber-300 bg-amber-50/20 shadow-md shadow-amber-500/5 md:border-l-[6px] md:border-l-amber-500" : 
      "border-[#e5e5e0]"
    )}>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main Info */}
        <div className="flex-1">
          <div className="flex items-start justify-between mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#5A5A40] opacity-60">PAC</span>
                <h3 className="text-xl font-display font-bold tracking-tight">{batch.pac}</h3>
              </div>
              {hasPassedToleranceDate && (
                <span
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2.5 py-1 rounded-lg"
                  title={`Alerta acionado somente após passar a data de tolerância (${pacDelivery.effectiveMaxDays}d da data inicial). ${pacDelivery.elapsedDays !== null ? `Recebido após ${pacDelivery.elapsedDays} dias (+${pacDelivery.daysOverLimit}d além da tolerância).` : 'Prazo limite de tolerância ultrapassado.'}`}
                >
                  <AlertTriangle size={12} className="text-amber-600 animate-pulse" /> ALERTA • FORA DA TOLERÂNCIA {pacDelivery.elapsedDays !== null ? `(${pacDelivery.elapsedDays}d / Limite ${pacDelivery.effectiveMaxDays}d)` : `(Limite ${format(deadline, 'dd/MM/yyyy')})`}
                </span>
              )}
              {!hasPassedToleranceDate && pacDelivery.appliedExtensions && pacDelivery.appliedExtensions.length > 0 && (
                <span
                  className="flex items-center gap-1 text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-lg"
                  title={`Prazo ampliado/abonado por período de recesso ou feriado: ${pacDelivery.appliedExtensions.map((e: any) => e.name).join(', ')}`}
                >
                  <Calendar size={11} className="text-teal-600" />
                  {pacDelivery.isDisregardedByRecess
                    ? `Prazo Desconsiderado (${pacDelivery.appliedExtensions[0].name})`
                    : `Prazo Ampliado +${pacDelivery.addedExtensionDays}d (${pacDelivery.appliedExtensions[0].name})`}
                </span>
              )}
              {isOverdue && (
                <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded-lg">
                  <AlertCircle size={12} /> ATRASADO
                </span>
              )}
            </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "px-3 py-1 text-xs font-bold rounded-full border",
                  isOverdue ? "bg-red-100 text-red-700 border-red-200" : 
                  isWarning ? "bg-amber-100 text-amber-700 border-amber-200" : 
                  "bg-[#f0f0e5] text-[#5A5A40] border-[#e5e5e0]"
                )}>
                  {dynamicStatus}
                </span>
                <button onClick={onEdit} className="p-2 hover:bg-[#f0f0e5] rounded-full text-[#5A5A40] transition-colors" title={canEdit ? "Editar Lote" : "Visualizar Detalhes"}>
                  {canEdit ? <Edit3 size={18} /> : <Eye size={18} />}
                </button>
                {canDelete && (
                  <button onClick={onDelete} className="p-2 hover:bg-red-50 rounded-full text-red-500 transition-colors" title="Excluir Lote">
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] uppercase font-bold text-[#5A5A40] opacity-50 mb-1">Período</p>
              <p className="text-sm font-medium">{formatPeriod(batch.periodoInicial)} - {formatPeriod(batch.periodoFinal)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-[#5A5A40] opacity-50 mb-1">Nº Ensaios</p>
              <p className="text-sm font-medium">{batch.numEnsaios}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-[#5A5A40] opacity-50 mb-1">Recebido por</p>
              <p className="text-sm font-medium">{batch.recebidoPor}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-[#5A5A40] opacity-50 mb-1">Recebido em</p>
              <p className="text-sm font-medium">{formatDate(batch.recebidoEm)}</p>
              {pacDelivery.maxDeadlineDate && (
                <p className="text-[10px] text-[#5A5A40]/70 mt-0.5">
                  Limite PAC (10d+7d): <span className="font-semibold">{format(pacDelivery.maxDeadlineDate, 'dd/MM/yyyy')}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Workflow Steps */}
        <div className="lg:w-80 flex flex-col gap-2 border-t lg:border-t-0 lg:border-l border-[#e5e5e0] pt-4 lg:pt-0 lg:pl-6">
          <WorkflowStep label="Lido" user={batch.lidoPor} date={batch.lidoEm} />
          <WorkflowStep label="Informado" user={batch.conferidoPor} date={batch.conferidoEm} />
        </div>
      </div>
    </div>
  );
}

function WorkflowStep({ label, user, date }: { label: string, user?: string, date?: any }) {
  const isDone = !!user && user.trim() !== '';
  const safeDate = toSafeDate(date);
  return (
    <div className={cn(
      "flex items-center gap-3 p-2 rounded-xl transition-colors",
      isDone ? "bg-emerald-50/50" : "bg-[#f5f5f0]/50"
    )}>
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
        isDone ? "bg-emerald-500 text-white" : "bg-[#e5e5e0] text-[#5A5A40]"
      )}>
        {isDone ? <Check size={14} /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-tight opacity-60">{label}</p>
        <p className="text-xs font-medium truncate">
          {isDone ? (safeDate ? `${user} • ${format(safeDate, "dd/MM/yy")}` : user) : 'Pendente'}
        </p>
      </div>
    </div>
  );
}

function SearchableSelect({ label, value, options, onChange, placeholder, required }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    return options.filter((opt: any) => 
      opt.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [options, search]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((opt: any) => opt.name === value);

  return (
    <div className="space-y-2 relative" ref={containerRef}>
      <label className="text-xs font-bold uppercase text-[#5A5A40]">{label}</label>
      <div 
        className="relative cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl focus-within:ring-2 focus-within:ring-[#5A5A40]/20 flex items-center justify-between">
          <span className={cn("text-sm", !value && "text-[#5A5A40]/50")}>
            {value || placeholder}
          </span>
          <ChevronDown size={18} className={cn("text-[#5A5A40]/50 transition-transform", isOpen && "rotate-180")} />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-[#e5e5e0] rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-2 border-b border-[#e5e5e0] sticky top-0 bg-white">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A5A40]/40" size={14} />
              <input 
                type="text"
                autoFocus
                className="w-full pl-9 pr-3 py-2 bg-[#f5f5f0] border-none rounded-lg text-sm focus:outline-none"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt: any) => (
                <div 
                  key={opt.id}
                  className={cn(
                    "px-4 py-2 text-sm hover:bg-[#f5f5f0] cursor-pointer transition-colors",
                    value === opt.name && "bg-[#5A5A40]/5 font-bold text-[#5A5A40]"
                  )}
                  onClick={() => {
                    onChange(opt.name);
                    setIsOpen(false);
                    setSearch('');
                  }}
                >
                  {opt.name}
                </div>
              ))
            ) : (
              <div className="px-4 py-3 text-sm text-[#5A5A40]/50 italic">
                Nenhum resultado encontrado
              </div>
            )}
          </div>
        </div>
      )}
      <input type="hidden" required={required} value={value} />
    </div>
  );
}

function BatchModal({ isOpen, onClose, batch, pacs, collaborators, statuses, nonConformitiesConfigs, handleFirestoreError, isLocalMode, onSaveLocalBatch }: any) {
  const [localError, setLocalError] = useState<string | null>(null);
  const initialPInicialStr = toSafeDate(batch?.periodoInicial) ? format(toSafeDate(batch.periodoInicial)!, "yyyy-MM-dd") : '';
  const initialRecebidoStr = toSafeDate(batch?.recebidoEm) ? format(toSafeDate(batch.recebidoEm)!, "yyyy-MM-dd") : (batch ? '' : format(new Date(), "yyyy-MM-dd"));
  const initialEval = evaluatePacDeliveryDeadline(
    initialPInicialStr ? parseLocalDate(initialPInicialStr) : null,
    initialRecebidoStr ? parseLocalDate(initialRecebidoStr) : null,
    batch?.ensaioForaDoPrazo
  );

  const [formData, setFormData] = useState({
    pac: batch?.pac || '',
    periodoInicial: initialPInicialStr,
    periodoFinal: toSafeDate(batch?.periodoFinal) ? format(toSafeDate(batch.periodoFinal)!, "yyyy-MM-dd") : '',
    numEnsaios: batch?.numEnsaios || 0,
    status: batch?.status || 'ABERTO', // Default to ABERTO
    recebidoPor: batch?.recebidoPor || '',
    recebidoEmDate: initialRecebidoStr,
    lidoPor: batch?.lidoPor || '',
    lidoEmDate: toSafeDate(batch?.lidoEm) ? format(toSafeDate(batch.lidoEm)!, "yyyy-MM-dd") : '',
    conferidoPor: batch?.conferidoPor || '',
    conferidoEmDate: toSafeDate(batch?.conferidoEm) ? format(toSafeDate(batch.conferidoEm)!, "yyyy-MM-dd") : '',
    ensaioForaDoPrazo: initialEval.isLate,
  });

  // Live calculation of the 10d + 7d Correios = 17d PAC delivery deadline in BatchModal
  const modalDeadlineEval = useMemo(() => {
    const pDate = formData.periodoInicial ? parseLocalDate(formData.periodoInicial) : null;
    const rDate = formData.recebidoEmDate ? parseLocalDate(formData.recebidoEmDate) : null;
    return evaluatePacDeliveryDeadline(pDate, rDate, formData.ensaioForaDoPrazo);
  }, [formData.periodoInicial, formData.recebidoEmDate, formData.ensaioForaDoPrazo]);

  // Non-conformity specific states within BatchModal
  const [activeSubView, setActiveSubView] = useState<'main' | 'addNonConformity'>('main');
  const [localNonConformities, setLocalNonConformities] = useState<any[]>([]);
  const [nonConformityItems, setNonConformityItems] = useState<{ plate: string; reasonId: string }[]>([
    { plate: '', reasonId: '' }
  ]);
  const [subError, setSubError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (isLocalMode) {
      setLocalNonConformities(batch?.nonConformities || []);
    } else if (batch) {
      const fetchNCs = async () => {
        try {
          const q = query(
            collection(db, 'lote_nao_conformidades'), 
            where('recebimento_lote_id', '==', batch.id)
          );
          const snapshot = await getDocs(q);
          const list = snapshot.docs.map(docRef => {
            const data = docRef.data();
            const reason = nonConformitiesConfigs?.find((c: any) => c.id === data.nao_conformidade_id);
            return {
              id: docRef.id,
              nao_conformidade_id: data.nao_conformidade_id,
              nao_conformidade_name: reason ? reason.name : (data.nao_conformidade_name || 'Outro'),
              placas: data.placas || []
            };
          });
          setLocalNonConformities(list);
        } catch (err) {
          console.error("Error loading non-conformities", err);
        }
      };
      fetchNCs();
    } else {
      setLocalNonConformities([]);
    }
  }, [batch, isOpen, isLocalMode, nonConformitiesConfigs]);

  const handleIncludeClick = () => {
    if (!formData.pac) {
      setLocalError("Por favor, selecione um PAC antes de registrar uma não-conformidade.");
      return;
    }
    setNonConformityItems([{ plate: '', reasonId: '' }]);
    setSubError(null);
    setActiveSubView('addNonConformity');
  };

  const handleAddNonConformityItem = () => {
    setNonConformityItems([...nonConformityItems, { plate: '', reasonId: '' }]);
  };

  const handleNonConformityItemChange = (index: number, field: 'plate' | 'reasonId', val: string) => {
    const updated = [...nonConformityItems];
    updated[index] = {
      ...updated[index],
      [field]: field === 'plate' ? val.toUpperCase() : val
    };
    setNonConformityItems(updated);
  };

  const handleRemoveNonConformityItem = (index: number) => {
    setNonConformityItems(nonConformityItems.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Auto-status logic: if "Informado" field is filled, status becomes FINALIZADO automatically. If not, fallback to default status
    const hasInformado = formData.conferidoPor && formData.conferidoPor.trim() !== '';
    let finalStatus = formData.status;
    if (hasInformado) {
      finalStatus = 'FINALIZADO';
    } else {
      if (finalStatus === 'FINALIZADO') {
        finalStatus = 'ABERTO';
      }
    }

    try {
      const getTimestampFromDate = (date: Date) => {
        return isLocalMode ? LocalTimestamp.fromDate(date) : Timestamp.fromDate(date);
      };
      
      const getTimestampNow = () => {
        return isLocalMode ? LocalTimestamp.now() : Timestamp.now();
      };

      let normPac = formData.pac ? formData.pac.trim() : '';
      if (normPac.toUpperCase() === 'CALIXTO' || normPac.toUpperCase() === 'PAC CALIXTO' || (normPac.toUpperCase().includes('CALIXTO') && !normPac.toUpperCase().includes('JOSÉ') && !normPac.toUpperCase().includes('JOSE'))) {
        normPac = 'JOSÉ CALIXTO';
      }

      // Compute exact insertion timestamp for each production activity:
      // When a collaborator name is inserted or changed, its date is recorded.
      // If dates differ between fields, each field preserves its respective insertion date.
      const computeActivityTimestamp = (
        collabName: string,
        dateStr: string,
        existingCollabName: string | undefined,
        existingTimestamp: any
      ) => {
        const cleanName = (collabName || '').trim();
        if (!cleanName) return null;

        if (dateStr) {
          if (existingTimestamp && cleanName === (existingCollabName || '').trim()) {
            try {
              const existingDate = existingTimestamp.toDate ? existingTimestamp.toDate() : new Date(existingTimestamp.seconds * 1000);
              const existingDateStr = format(existingDate, "yyyy-MM-dd");
              if (existingDateStr === dateStr) {
                return existingTimestamp;
              }
            } catch {
              // fallback
            }
          }
          return getTimestampFromDate(parseLocalDate(dateStr));
        }

        if (cleanName === (existingCollabName || '').trim() && existingTimestamp) {
          return existingTimestamp;
        }

        return getTimestampNow();
      };

      const finalRecebidoEm = computeActivityTimestamp(
        formData.recebidoPor,
        formData.recebidoEmDate,
        batch?.recebidoPor,
        batch?.recebidoEm
      );

      const finalLidoEm = computeActivityTimestamp(
        formData.lidoPor,
        formData.lidoEmDate,
        batch?.lidoPor,
        batch?.lidoEm
      );

      const finalConferidoEm = computeActivityTimestamp(
        formData.conferidoPor,
        formData.conferidoEmDate,
        batch?.conferidoPor,
        batch?.conferidoEm
      );

      const { recebidoEmDate, lidoEmDate, conferidoEmDate, ...cleanFormData } = formData;

      const data = {
        ...cleanFormData,
        pac: normPac,
        status: finalStatus,
        numEnsaios: Number(formData.numEnsaios),
        periodoInicial: getTimestampFromDate(parseLocalDate(formData.periodoInicial)),
        periodoFinal: getTimestampFromDate(parseLocalDate(formData.periodoFinal)),
        recebidoEm: finalRecebidoEm || (batch?.recebidoEm || getTimestampNow()),
        lidoEm: finalLidoEm,
        conferidoEm: finalConferidoEm,
      };

      if (isLocalMode) {
        onSaveLocalBatch(data, localNonConformities);
        onClose();
        return;
      }

      let batchId = '';
      if (batch) {
        batchId = batch.id;
        await updateDoc(doc(db, 'batches', batch.id), {
          ...data,
          nonConformities: localNonConformities
        });
      } else {
        const docRef = await addDoc(collection(db, 'batches'), {
          ...data,
          nonConformities: localNonConformities
        });
        batchId = docRef.id;
      }

      // Sync nonconformities in Firestore
      const q = query(
        collection(db, 'lote_nao_conformidades'), 
        where('recebimento_lote_id', '==', batchId)
      );
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(docRef => deleteDoc(docRef.ref));
      await Promise.all(deletePromises);

      const addPromises = localNonConformities.map(item => {
        return addDoc(collection(db, 'lote_nao_conformidades'), {
          recebimento_lote_id: batchId,
          nao_conformidade_id: item.nao_conformidade_id,
          pac_id: data.pac,
          placas: item.placas
        });
      });
      await Promise.all(addPromises);

      onClose();
    } catch (err) {
      handleFirestoreError(err, batch ? OperationType.UPDATE : OperationType.CREATE, 'batches');
    }
  };

  if (activeSubView === 'addNonConformity') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200">
          <div className="p-8 border-b border-[#e5e5e0] flex items-center justify-between col-span-full">
            <h2 className="text-2xl font-display font-bold tracking-tight text-[#5A5A40]">Cadastrar Não-Conformidade</h2>
            <button 
              type="button"
              onClick={() => setActiveSubView('main')} 
              className="p-2 hover:bg-[#f5f5f0] rounded-full"
            >
              <X size={24} />
            </button>
          </div>
          
          <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
            {subError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle size={18} />
                  <p className="text-sm">{subError}</p>
                </div>
                <button type="button" onClick={() => setSubError(null)}><X size={18} /></button>
              </div>
            )}

            <div className="space-y-4">
              <label className="text-xs font-bold uppercase text-[#5A5A40]">Placas e Seus Motivos Relacionados</label>
              
              <div className="space-y-4">
                {nonConformityItems.map((item, index) => (
                  <div key={index} className="flex flex-col sm:flex-row gap-3 p-4 bg-[#f5f5f0]/50 rounded-2xl border border-[#e5e5e0] relative">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-[#5A5A40]/70">Placa Afetada</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: ABC1234"
                        className="w-full p-3 bg-white border border-[#e5e5e0] rounded-xl focus:ring-2 focus:ring-[#5A5A40]/20 font-mono text-sm uppercase"
                        value={item.plate}
                        onChange={e => handleNonConformityItemChange(index, 'plate', e.target.value)}
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>
                    
                    <div className="flex-[2] space-y-1">
                      <label className="text-[10px] font-bold uppercase text-[#5A5A40]/70">Motivo de Não-Conformidade</label>
                      <select
                        required
                        className="w-full p-3 bg-white border border-[#e5e5e0] rounded-xl focus:ring-2 focus:ring-[#5A5A40]/20 text-sm"
                        value={item.reasonId}
                        onChange={e => handleNonConformityItemChange(index, 'reasonId', e.target.value)}
                      >
                        <option value="">Selecionar não-conformidade</option>
                        {nonConformitiesConfigs.map((nc: any) => (
                          <option key={nc.id} value={nc.id}>
                            {nc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {nonConformityItems.length > 1 && (
                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveNonConformityItem(index)}
                          className="p-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors self-end"
                          title="Remover placa e motivo"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <button
                type="button"
                onClick={handleAddNonConformityItem}
                className="text-[#5A5A40] text-sm font-bold flex items-center gap-1 hover:underline mt-2"
              >
                <Plus size={16} />
                Adicionar Outra Placa / Motivo
              </button>
            </div>

            <div className="pt-6 flex gap-3 border-t border-[#e5e5e0]">
              <button
                type="button"
                onClick={() => setActiveSubView('main')}
                className="flex-1 px-6 py-3 rounded-2xl font-medium border border-[#e5e5e0] hover:bg-[#f5f5f0] transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const incompleteRow = nonConformityItems.find(item => {
                    const p = item.plate.trim();
                    const r = item.reasonId;
                    return (p !== '' && r === '') || (p === '' && r !== '');
                  });
                  if (incompleteRow) {
                    setSubError("Por favor, preencha a placa e escolha o motivo para todos os itens cadastrados.");
                    return;
                  }

                  const validItems = nonConformityItems.filter(item => item.plate.trim() !== '' && item.reasonId !== '');
                  if (validItems.length === 0) {
                    setSubError("Por favor, informe pelo menos uma placa com seu motivo.");
                    return;
                  }

                  const newNCObjects = validItems.map(item => {
                    const reason = nonConformitiesConfigs.find((c: any) => c.id === item.reasonId);
                    return {
                      id: 'nc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
                      nao_conformidade_id: item.reasonId,
                      nao_conformidade_name: reason ? reason.name : 'Outro',
                      placas: [item.plate.trim().toUpperCase()]
                    };
                  });

                  setLocalNonConformities([...localNonConformities, ...newNCObjects]);
                  setActiveSubView('main');
                }}
                className="flex-1 px-6 py-3 bg-[#5A5A40] text-white rounded-2xl font-medium hover:bg-[#4a4a30] transition-all"
              >
                Salvar Não-Conformidade
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-8 border-b border-[#e5e5e0] flex items-center justify-between">
          <h2 className="text-2xl font-display font-bold tracking-tight">{batch ? 'Editar Lote' : 'Receber Novo Lote'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-[#f5f5f0] rounded-full"><X size={24} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          {localError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} />
                <p className="text-sm">{localError}</p>
              </div>
              <button type="button" onClick={() => setLocalError(null)}><X size={18} /></button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SearchableSelect 
              label="PAC"
              value={formData.pac}
              options={pacs}
              onChange={(val: string) => setFormData({...formData, pac: val})}
              placeholder="Selecionar PAC"
              required
            />

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-[#5A5A40]">Status</label>
              <select 
                required
                className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl focus:ring-2 focus:ring-[#5A5A40]/20"
                value={formData.status}
                onChange={e => setFormData({...formData, status: e.target.value})}
              >
                <option value="">Selecionar Status</option>
                {statuses.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-[#5A5A40]">Período Inicial</label>
              <input 
                type="date" required
                className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl focus:ring-2 focus:ring-[#5A5A40]/20"
                value={formData.periodoInicial}
                onChange={e => {
                  const newPInicial = e.target.value;
                  const pDate = newPInicial ? parseLocalDate(newPInicial) : null;
                  const rDate = formData.recebidoEmDate ? parseLocalDate(formData.recebidoEmDate) : null;
                  const evalResult = evaluatePacDeliveryDeadline(pDate, rDate, undefined);
                  setFormData(prev => ({
                    ...prev,
                    periodoInicial: newPInicial,
                    ensaioForaDoPrazo: (pDate && rDate) ? evalResult.isOver17Days : prev.ensaioForaDoPrazo
                  }));
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-[#5A5A40]">Período Final</label>
              <input 
                type="date" required
                className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl focus:ring-2 focus:ring-[#5A5A40]/20"
                value={formData.periodoFinal}
                onChange={e => setFormData({...formData, periodoFinal: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-[#5A5A40]">Nº de Ensaios</label>
              <input 
                type="number" required
                className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl focus:ring-2 focus:ring-[#5A5A40]/20"
                value={formData.numEnsaios}
                onChange={e => setFormData({...formData, numEnsaios: Number(e.target.value)})}
              />
            </div>
          </div>

          <div className="pt-6 border-t border-[#e5e5e0] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <h4 className="text-sm font-bold uppercase text-[#5A5A40] opacity-50">Produção</h4>
              <span className="text-[10px] text-gray-500 font-medium">
                Datas de inserção individuais para apuração de produtividade
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Recebido Por */}
              <div className="p-3 bg-[#fbfbfa] rounded-2xl border border-[#e5e5e0] space-y-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase text-[#5A5A40]">Recebido Por</label>
                    {formData.recebidoEmDate && (
                      <span className="text-[9px] font-mono text-gray-400">
                        {format(parseLocalDate(formData.recebidoEmDate), 'dd/MM/yyyy')}
                      </span>
                    )}
                  </div>
                    <select 
                    required
                    className="w-full p-2 bg-white border border-[#e5e5e0] rounded-lg text-sm font-medium focus:ring-2 focus:ring-[#5A5A40]/20"
                    value={formData.recebidoPor}
                    onChange={e => {
                      const val = e.target.value;
                      setFormData(prev => {
                        const nextRecDate = val ? (prev.recebidoEmDate || format(new Date(), "yyyy-MM-dd")) : '';
                        const pDate = prev.periodoInicial ? parseLocalDate(prev.periodoInicial) : null;
                        const rDate = nextRecDate ? parseLocalDate(nextRecDate) : null;
                        const evalResult = evaluatePacDeliveryDeadline(pDate, rDate, undefined);
                        return {
                          ...prev,
                          recebidoPor: val,
                          recebidoEmDate: nextRecDate,
                          ensaioForaDoPrazo: (pDate && rDate) ? evalResult.isOver17Days : prev.ensaioForaDoPrazo
                        };
                      });
                    }}
                  >
                    <option value="">- Selecione -</option>
                    {collaborators.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                {formData.recebidoPor && (
                  <div className="space-y-1 pt-1 border-t border-gray-100">
                    <label className="text-[9px] font-bold uppercase text-gray-500">Data de Recebimento</label>
                    <input
                      type="date"
                      className="w-full p-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs font-mono text-gray-700 focus:ring-1 focus:ring-[#5A5A40]/30"
                      value={formData.recebidoEmDate}
                      onChange={e => {
                        const newRecDate = e.target.value;
                        const pDate = formData.periodoInicial ? parseLocalDate(formData.periodoInicial) : null;
                        const rDate = newRecDate ? parseLocalDate(newRecDate) : null;
                        const evalResult = evaluatePacDeliveryDeadline(pDate, rDate, undefined);
                        setFormData(prev => ({
                          ...prev,
                          recebidoEmDate: newRecDate,
                          ensaioForaDoPrazo: (pDate && rDate) ? evalResult.isOver17Days : prev.ensaioForaDoPrazo
                        }));
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Lido Por */}
              <div className="p-3 bg-[#fbfbfa] rounded-2xl border border-[#e5e5e0] space-y-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase text-[#5A5A40]">Lido Por</label>
                    {formData.lidoEmDate && (
                      <span className="text-[9px] font-mono text-gray-400">
                        {format(parseLocalDate(formData.lidoEmDate), 'dd/MM/yyyy')}
                      </span>
                    )}
                  </div>
                  <select 
                    className="w-full p-2 bg-white border border-[#e5e5e0] rounded-lg text-sm font-medium focus:ring-2 focus:ring-[#5A5A40]/20"
                    value={formData.lidoPor}
                    onChange={e => {
                      const val = e.target.value;
                      setFormData(prev => ({
                        ...prev,
                        lidoPor: val,
                        lidoEmDate: val ? (prev.lidoEmDate || format(new Date(), "yyyy-MM-dd")) : ''
                      }));
                    }}
                  >
                    <option value="">- Selecione -</option>
                    {collaborators.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                {formData.lidoPor && (
                  <div className="space-y-1 pt-1 border-t border-gray-100">
                    <label className="text-[9px] font-bold uppercase text-gray-500">Data de Leitura</label>
                    <input
                      type="date"
                      className="w-full p-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs font-mono text-gray-700 focus:ring-1 focus:ring-[#5A5A40]/30"
                      value={formData.lidoEmDate}
                      onChange={e => setFormData({ ...formData, lidoEmDate: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {/* Informado Por */}
              <div className="p-3 bg-[#fbfbfa] rounded-2xl border border-[#e5e5e0] space-y-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase text-[#5A5A40]">Informado Por</label>
                    {formData.conferidoEmDate && (
                      <span className="text-[9px] font-mono text-gray-400">
                        {format(parseLocalDate(formData.conferidoEmDate), 'dd/MM/yyyy')}
                      </span>
                    )}
                  </div>
                  <select 
                    className="w-full p-2 bg-white border border-[#e5e5e0] rounded-lg text-sm font-medium focus:ring-2 focus:ring-[#5A5A40]/20"
                    value={formData.conferidoPor}
                    onChange={e => {
                      const val = e.target.value;
                      setFormData(prev => ({
                        ...prev,
                        conferidoPor: val,
                        conferidoEmDate: val ? (prev.conferidoEmDate || format(new Date(), "yyyy-MM-dd")) : ''
                      }));
                    }}
                  >
                    <option value="">- Selecione -</option>
                    {collaborators.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                {formData.conferidoPor && (
                  <div className="space-y-1 pt-1 border-t border-gray-100">
                    <label className="text-[9px] font-bold uppercase text-gray-500">Data de Informação</label>
                    <input
                      type="date"
                      className="w-full p-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs font-mono text-gray-700 focus:ring-1 focus:ring-[#5A5A40]/30"
                      value={formData.conferidoEmDate}
                      onChange={e => setFormData({ ...formData, conferidoEmDate: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {/* Checkbox & Cálculo Automático: ensaio entregue fora do prazo (10d + 7d Correios + ampliações de recesso) */}
              <div className={cn(
                "col-span-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 p-3.5 rounded-2xl border border-dashed transition-colors",
                formData.ensaioForaDoPrazo && !modalDeadlineEval.isDisregardedByRecess
                  ? "bg-amber-50/70 border-amber-300"
                  : modalDeadlineEval.isDisregardedByRecess || (modalDeadlineEval.addedExtensionDays || 0) > 0
                    ? "bg-teal-50/60 border-teal-300"
                    : modalDeadlineEval.isWithinCorreiosTolerance
                      ? "bg-blue-50/50 border-blue-200"
                      : "bg-emerald-50/40 border-emerald-200"
              )}>
                <div className="flex items-start sm:items-center gap-2.5">
                  <input 
                    type="checkbox"
                    id="ensaioForaDoPrazo"
                    className="h-4 w-4 mt-0.5 sm:mt-0 rounded border-amber-300 text-amber-600 focus:ring-amber-500/30 cursor-pointer"
                    checked={formData.ensaioForaDoPrazo}
                    onChange={e => setFormData({...formData, ensaioForaDoPrazo: e.target.checked})}
                  />
                  <div>
                    <label htmlFor="ensaioForaDoPrazo" className="text-xs font-bold text-[#5A5A40] cursor-pointer select-none block">
                      Ensaio entregue fora do prazo pelo PAC
                    </label>
                    <span className="text-[10px] text-gray-500 block mt-0.5">
                      Regra: <strong>10 dias</strong> da Data Inicial + <strong>7 dias</strong> (Correios) = <strong>17 dias</strong>
                      {(modalDeadlineEval.addedExtensionDays || 0) > 0 && (
                        <strong className="text-teal-700"> (+{modalDeadlineEval.addedExtensionDays}d ampliação de recesso/feriado = {modalDeadlineEval.effectiveMaxDays}d)</strong>
                      )}
                      {modalDeadlineEval.isDisregardedByRecess && (
                        <strong className="text-teal-700"> (Prazo desconsiderado por Recesso/Feriado ativo)</strong>
                      )}
                      .
                    </span>
                  </div>
                </div>

                {modalDeadlineEval.maxDeadlineDate && (
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end text-[11px]">
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 font-mono">
                      Limite ({modalDeadlineEval.effectiveMaxDays}d): <strong>{format(modalDeadlineEval.maxDeadlineDate, 'dd/MM/yyyy')}</strong>
                    </span>
                    {modalDeadlineEval.appliedExtensions && modalDeadlineEval.appliedExtensions.length > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-teal-100 text-teal-800 border border-teal-200 font-bold">
                        {modalDeadlineEval.appliedExtensions.map((e: any) => e.name).join(', ')}
                      </span>
                    )}
                    {modalDeadlineEval.elapsedDays !== null && (
                      <span className={cn(
                        "px-2.5 py-1 rounded-lg font-bold",
                        modalDeadlineEval.isDisregardedByRecess || (modalDeadlineEval.isExemptByCheckbox && modalDeadlineEval.isOver17Days)
                          ? "bg-teal-100 text-teal-900 border border-teal-300"
                          : modalDeadlineEval.isLate
                            ? "bg-amber-100 text-amber-900 border border-amber-300"
                            : modalDeadlineEval.isWithinCorreiosTolerance
                              ? "bg-blue-100 text-blue-800 border border-blue-200"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      )}>
                        {modalDeadlineEval.elapsedDays} dias corridos • {
                          modalDeadlineEval.isDisregardedByRecess
                            ? 'Isento (Recesso/Feriado)'
                            : (modalDeadlineEval.isExemptByCheckbox && modalDeadlineEval.isOver17Days)
                              ? 'Isento de Atraso (Checkbox Desmarcado)'
                              : modalDeadlineEval.isLate
                                ? `Fora do Prazo (+${modalDeadlineEval.daysOverLimit}d)`
                                : modalDeadlineEval.isWithinCorreiosTolerance
                                  ? 'Dentro da Tolerância (OK)'
                                  : 'No Prazo Base (≤10d)'
                        }
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-[#e5e5e0] space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase text-[#5A5A40] opacity-50">Lote com Não-Conformidade</h4>
              <button
                type="button"
                onClick={handleIncludeClick}
                className={cn(
                  "px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 border transition-all",
                  formData.pac
                    ? "bg-[#f5f5f0] text-[#5A5A40] border-[#5A5A40]/10 hover:bg-[#e5e5e0]"
                    : "opacity-50 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-200"
                )}
              >
                <Plus size={14} />
                INCLUIR
              </button>
            </div>

            {localNonConformities.length > 0 ? (
              <div className="border border-[#e5e5e0] rounded-2xl overflow-hidden divide-y divide-[#e5e5e0]">
                {localNonConformities.map((item, index) => (
                  <div key={item.id || index} className="p-4 flex justify-between items-center bg-[#f5f5f0]/30 hover:bg-[#f5f5f0]/50 transition-colors animate-in fade-in duration-200">
                    <div>
                      <p className="font-bold text-sm text-[#5A5A40]">{item.nao_conformidade_name}</p>
                      <p className="text-xs text-gray-500 font-mono mt-1">
                        Placas: {item.placas.join(', ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLocalNonConformities(localNonConformities.filter(nc => nc.id !== item.id))}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Excluir"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Nenhuma não-conformidade registrada para este lote.</p>
            )}
          </div>

          <div className="pt-6 flex gap-3 border-t border-[#e5e5e0]">
            <button 
              type="button" onClick={onClose}
              className="flex-1 px-6 py-3 rounded-2xl font-medium border border-[#e5e5e0] hover:bg-[#f5f5f0] transition-all"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="flex-1 px-6 py-3 bg-[#5A5A40] text-white rounded-2xl font-medium hover:bg-[#4a4a30] transition-all"
            >
              {batch ? 'Salvar Alterações' : 'Confirmar Recebimento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatCNPJ(value: string) {
  const digits = value.replace(/\D/g, '').substring(0, 14);
  let res = digits;
  if (digits.length > 12) {
    res = `${digits.substring(0, 2)}.${digits.substring(2, 5)}.${digits.substring(5, 8)}/${digits.substring(8, 12)}-${digits.substring(12)}`;
  } else if (digits.length > 8) {
    res = `${digits.substring(0, 2)}.${digits.substring(2, 5)}.${digits.substring(5, 8)}/${digits.substring(8)}`;
  } else if (digits.length > 5) {
    res = `${digits.substring(0, 2)}.${digits.substring(2, 5)}.${digits.substring(5)}`;
  } else if (digits.length > 2) {
    res = `${digits.substring(0, 2)}.${digits.substring(2)}`;
  }
  return res;
}

function ConfigPanel({ 
  pacs, 
  collaborators, 
  statuses, 
  nonConformitiesConfigs,
  nonConformityRecords,
  notificationTypes,
  framings,
  setFramings,
  handleFirestoreError, 
  onUpdate, 
  setConfigToDelete, 
  isLocalMode, 
  batches, 
  setBatches, 
  setPacs, 
  setCollaborators, 
  setStatuses,
  setNonConformitiesConfigs,
  setNotificationTypes,
  logoUrl,
  saveLogoUrl,
  signatures,
  saveSignatures,
  configPassword,
  saveConfigPassword,
  deadlineExtensions = [],
  saveDeadlineExtensions,
  isConfigUnlocked,
  setIsConfigUnlocked,
  setActiveTab
}: any) {
  const [activeConfig, setActiveConfig] = useState<'pacs' | 'collabs' | 'status' | 'non_conformities' | 'notification_types' | 'deadlines' | 'import' | 'branding' | 'security'>('pacs');
  const [newItemName, setNewItemName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Estados para Ampliação e Suspensão de Prazos (Recessos / Feriados)
  const [extName, setExtName] = useState('');
  const [extStartDate, setExtStartDate] = useState('');
  const [extEndDate, setExtEndDate] = useState('');
  const [extMode, setExtMode] = useState<'add_days' | 'disregard'>('add_days');
  const [extCustomDays, setExtCustomDays] = useState<string>('');
  const [editingExtId, setEditingExtId] = useState<string | null>(null);
  const [extStatusMsg, setExtStatusMsg] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSyncingBatchDeadlines, setIsSyncingBatchDeadlines] = useState(false);

  const calculatedExtIntervalDays = useMemo(() => {
    if (!extStartDate || !extEndDate) return 0;
    const s = startOfDay(parseLocalDate(extStartDate));
    const e = startOfDay(parseLocalDate(extEndDate));
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || isAfter(s, e)) return 0;
    return differenceInDays(e, s) + 1;
  }, [extStartDate, extEndDate]);

  const handleSaveDeadlineExtension = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extName.trim()) {
      setExtStatusMsg({ type: 'error', message: 'Informe um nome de controle para a ampliação/recesso (ex: Recesso Final de Ano).' });
      return;
    }
    if (!extStartDate || !extEndDate) {
      setExtStatusMsg({ type: 'error', message: 'Informe a data inicial e a data final do período.' });
      return;
    }
    const sDate = startOfDay(parseLocalDate(extStartDate));
    const eDate = startOfDay(parseLocalDate(extEndDate));
    if (isAfter(sDate, eDate)) {
      setExtStatusMsg({ type: 'error', message: 'A data inicial não pode ser posterior à data final do intervalo.' });
      return;
    }

    const intervalDays = Math.max(1, differenceInDays(eDate, sDate) + 1);
    const parsedCustom = extCustomDays.trim() !== '' ? Number(extCustomDays) : intervalDays;
    const finalCustomDays = extMode === 'add_days' ? Math.max(1, isNaN(parsedCustom) ? intervalDays : parsedCustom) : intervalDays;

    const currentList: DeadlineExtension[] = Array.isArray(deadlineExtensions) ? deadlineExtensions : [];
    let updatedList: DeadlineExtension[];

    if (editingExtId) {
      updatedList = currentList.map(item =>
        item.id === editingExtId
          ? {
              ...item,
              name: extName.trim(),
              startDate: extStartDate,
              endDate: extEndDate,
              mode: extMode,
              customDays: finalCustomDays
            }
          : item
      );
    } else {
      const newExt: DeadlineExtension = {
        id: 'ext_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: extName.trim(),
        startDate: extStartDate,
        endDate: extEndDate,
        mode: extMode,
        customDays: finalCustomDays,
        active: true,
        createdAt: new Date().toISOString()
      };
      updatedList = [newExt, ...currentList];
    }

    await saveDeadlineExtensions(updatedList);
    setExtStatusMsg({
      type: 'success',
      message: editingExtId
        ? `Ampliação "${extName.trim()}" atualizada com sucesso!`
        : `Nova ampliação "${extName.trim()}" adicionada e aplicada aos cálculos de prazo!`
    });
    setEditingExtId(null);
    setExtName('');
    setExtStartDate('');
    setExtEndDate('');
    setExtMode('add_days');
    setExtCustomDays('');
  };

  const handleSyncBatchesWithExtensions = async (extsToApply: DeadlineExtension[]) => {
    if (!batches || batches.length === 0) return;
    setIsSyncingBatchDeadlines(true);
    try {
      let changedCount = 0;
      const toUpdate: Array<{ id: string; ensaioForaDoPrazo: boolean }> = [];

      const updatedLocal = batches.map((b: Batch) => {
        const evalRes = evaluatePacDeliveryDeadline(b.periodoInicial, b.recebidoEm, b.ensaioForaDoPrazo, extsToApply);
        const shouldBeLate = evalRes.isLate;
        if (Boolean(b.ensaioForaDoPrazo) !== shouldBeLate && b.periodoInicial && b.recebidoEm) {
          changedCount++;
          toUpdate.push({ id: b.id, ensaioForaDoPrazo: shouldBeLate });
          return { ...b, ensaioForaDoPrazo: shouldBeLate };
        }
        return b;
      });

      if (isLocalMode) {
        setBatches(updatedLocal);
        localStorage.setItem('lotes_batches', JSON.stringify(updatedLocal));
      } else if (toUpdate.length > 0) {
        for (let i = 0; i < toUpdate.length; i += 400) {
          const chunk = toUpdate.slice(i, i + 400);
          const batchWrite = writeBatch(db);
          chunk.forEach(u => {
            batchWrite.update(doc(db, 'batches', u.id), { ensaioForaDoPrazo: u.ensaioForaDoPrazo });
          });
          await batchWrite.commit();
        }
      }

      setExtStatusMsg({
        type: 'success',
        message: changedCount > 0
          ? `Sincronização concluída: ${changedCount} lote(s) tiveram seu indicativo de prazo atualizado no banco conforme os períodos de recesso/feriados ativos!`
          : 'Todos os lotes já estão sincronizados com as regras de prazo e ampliações ativas.'
      });
    } catch (err) {
      console.error('Erro ao sincronizar lotes com ampliações:', err);
      setExtStatusMsg({ type: 'error', message: 'Erro ao sincronizar lotes no banco de dados.' });
    } finally {
      setIsSyncingBatchDeadlines(false);
    }
  };

  // Security Tab States
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<{type: 'success' | 'error', message: string} | null>(null);

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword) {
      setSecurityStatus({ type: 'error', message: 'A nova senha não pode ser vazia.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setSecurityStatus({ type: 'error', message: 'As senhas não coincidem. Certifique-se de que ambas sejam iguais.' });
      return;
    }
    try {
      await saveConfigPassword(newPassword);
      setSecurityStatus({ type: 'success', message: 'Senha de acesso alterada com sucesso!' });
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setSecurityStatus({ type: 'error', message: 'Erro ao salvar nova senha. Tente novamente.' });
    }
  };

  // PAC specific states
  const [newPacRazaoSocial, setNewPacRazaoSocial] = useState('');
  const [newPacCnpj, setNewPacCnpj] = useState('');
  const [editingPacRazaoSocial, setEditingPacRazaoSocial] = useState('');
  const [editingPacCnpj, setEditingPacCnpj] = useState('');

  // States for enquadramentos
  const [framingSearch, setFramingSearch] = useState('');
  const [newFramingNumber, setNewFramingNumber] = useState('');
  const [newFramingDescription, setNewFramingDescription] = useState('');
  const [editingFramingId, setEditingFramingId] = useState<string | null>(null);
  const [editingFramingNumber, setEditingFramingNumber] = useState('');
  const [editingFramingDescription, setEditingFramingDescription] = useState('');

  // States for linking non-conformity config to framing
  const [selectedFramingId, setSelectedFramingId] = useState('');
  const [editingConfigFramingId, setEditingConfigFramingId] = useState('');
  const [motivoSearch, setMotivoSearch] = useState('');

  // Signature Form States
  const [sigName, setSigName] = useState('');
  const [sigRole, setSigRole] = useState('');
  const [sigImage, setSigImage] = useState('');
  const [editingSigId, setEditingSigId] = useState<string | null>(null);

  // Import State
  const [importLink, setImportLink] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{type: 'success' | 'error' | 'info', message: string} | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Raw / Paste and review states
  const [pastedInput, setPastedInput] = useState('');
  const [previewItems, setPreviewItems] = useState<any[] | null>(null);
  const [isSavingPreview, setIsSavingPreview] = useState(false);

  const checkDuplicates = (itemsToImport: any[], existingBatches: any[]) => {
    const getBatchKeyString = (b: any) => {
      const pacPart = String(b.pac || '').trim().toUpperCase();
      const getTimestampDateStr = (ts: any) => {
        if (!ts) return '';
        let d: Date;
        if (ts.toDate && typeof ts.toDate === 'function') {
          d = ts.toDate();
        } else if (ts instanceof Date) {
          d = ts;
        } else if (typeof ts === 'string') {
          d = new Date(ts);
        } else if (ts.seconds) {
          d = new Date(ts.seconds * 1000);
        } else {
          d = new Date(ts);
        }
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
      };
      const pi = getTimestampDateStr(b.periodoInicial);
      const pf = getTimestampDateStr(b.periodoFinal);
      return `${pacPart}__${pi}__${pf}`;
    };

    const existingKeys = new Set(existingBatches.map(b => getBatchKeyString(b)));
    const seenInternalKeys = new Map<string, string[]>();

    const itemsWithDuplicates = itemsToImport.map(item => {
      const itemId = item.id || 'preview-' + Math.random().toString(36).substring(2, 9);
      const key = getBatchKeyString(item);
      
      let isDuplicate = false;
      let duplicateType: 'database' | 'internal' | undefined = undefined;

      if (existingKeys.has(key)) {
        isDuplicate = true;
        duplicateType = 'database';
      }

      if (!seenInternalKeys.has(key)) {
        seenInternalKeys.set(key, [itemId]);
      } else {
        seenInternalKeys.get(key)!.push(itemId);
      }

      return {
        ...item,
        id: itemId,
        isDuplicate,
        duplicateType,
        key
      };
    });

    return itemsWithDuplicates.map(item => {
      const ids = seenInternalKeys.get(item.key) || [];
      if (ids.length > 1) {
        return {
          ...item,
          isDuplicate: true,
          duplicateType: item.duplicateType || 'internal'
        };
      }
      return item;
    });
  };

  const handleAutoRemoveDuplicates = () => {
    if (!previewItems) return;
    const uniqueKeys = new Set<string>();
    const cleaned: any[] = [];
    
    previewItems.forEach(item => {
      if (item.duplicateType === 'database') {
        return;
      }
      if (!uniqueKeys.has(item.key)) {
        uniqueKeys.add(item.key);
        cleaned.push({
          ...item,
          isDuplicate: false,
          duplicateType: undefined
        });
      }
    });

    setPreviewItems(cleaned);
    setImportStatus({
      type: 'success',
      message: `Duplicados removidos. ${cleaned.length} itens prontos para importação.`
    });
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return '-';
    let d: Date;
    if (ts.toDate && typeof ts.toDate === 'function') {
      d = ts.toDate();
    } else if (ts instanceof Date) {
      d = ts;
    } else if (typeof ts === 'string') {
      d = new Date(ts);
    } else if (ts.seconds) {
      d = new Date(ts.seconds * 1000);
    } else {
      d = new Date(ts);
    }
    return isNaN(d.getTime()) ? '-' : format(d, 'dd/MM/yyyy');
  };

  const handleOneDriveLink = (url: string) => {
    // Basic conversion for OneDrive links
    if (url.includes('onedrive.live.com/view.aspx')) {
      return url.replace('view.aspx', 'download.aspx');
    }
    if (url.includes('1drv.ms')) {
      // Short links are hard to convert without a proxy, but we can try adding ?download=1
      return url + (url.includes('?') ? '&' : '?') + 'download=1';
    }
    return url;
  };

  const cleanString = (val: any): string => {
    if (val === null || val === undefined) return '';
    const s = String(val).trim();
    const lower = s.toLowerCase();
    if (lower === 'null' || lower === 'undefined' || lower === '-' || lower === 'n/a' || lower === 'na') {
      return '';
    }
    return s;
  };

  const parseCSV = (buffer: ArrayBuffer): any[] => {
    let text = '';
    try {
      text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('') || text.includes('')) {
        text = new TextDecoder('windows-1252').decode(buffer);
      }
    } catch (e) {
      text = new TextDecoder('windows-1252').decode(buffer);
    }

    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) {
      throw new Error('O arquivo CSV está vazio.');
    }

    // Sniff delimiter
    const firstLine = lines[0];
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ';' : ',';

    const parseCSVLine = (line: string, delim: string) => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delim && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseCSVLine(lines[0], delimiter);
    const data = lines.slice(1).map(line => {
      const values = parseCSVLine(line, delimiter);
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index] !== undefined ? values[index] : '';
      });
      return row;
    });

    return data;
  };

  const processParsedDataObjects = async (data: any[]) => {
    try {
      if (data.length === 0) {
        throw new Error('Nenhum dado legível foi encontrado.');
      }

      const parsedItems: any[] = [];

      for (const row of data) {
        // Mapping columns based on user's specific headers (case-insensitive support)
        const getVal = (names: string[]) => {
          for (const name of names) {
            if (row[name] !== undefined) return row[name];
            // Also check uppercase/lowercase variations and trim spaces
            const found = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase());
            if (found) return row[found];
          }
          return undefined;
        };

        const parseExcelDate = (val: any) => {
          if (!val) return null;
          
          if (val instanceof Date) {
            return isNaN(val.getTime()) ? null : Timestamp.fromDate(val);
          }

          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed === '') return null;

            if (trimmed.includes('T')) {
              const d = new Date(trimmed);
              if (!isNaN(d.getTime())) return Timestamp.fromDate(d);
            }

            const datePart = trimmed.split(' ')[0];
            if (datePart.includes('/') || datePart.includes('-')) {
              const separator = datePart.includes('/') ? '/' : '-';
              const parts = datePart.split(separator);
              if (parts.length === 3) {
                const first = parseInt(parts[0], 10);
                const second = parseInt(parts[1], 10);
                const third = parseInt(parts[2], 10);
                
                if (!isNaN(first) && !isNaN(second) && !isNaN(third)) {
                  let day = first;
                  let month = second - 1;
                  let year = third;
                  
                  if (first > 1000) { // YYYY-MM-DD
                    year = first;
                    month = second - 1;
                    day = third;
                  }

                  if (year < 100) { // 2-digit year
                    year += 2000;
                  }
                  
                  const date = new Date(year, month, day);
                  if (!isNaN(date.getTime())) return Timestamp.fromDate(date);
                }
              }
            }
          }

          if (typeof val === 'number') {
            const date = new Date((val - 25569) * 86400 * 1000);
            if (!isNaN(date.getTime())) return Timestamp.fromDate(date);
          }

          const date = new Date(val);
          return isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
        };

        let pac = cleanString(getVal(['PAC', 'Pacote', 'Lote', 'Identificação', 'Identificacao']));
        if (pac.toUpperCase().trim() === 'CALIXTO' || pac.toUpperCase().trim() === 'PAC CALIXTO' || (pac.toUpperCase().includes('CALIXTO') && !pac.toUpperCase().includes('JOSÉ') && !pac.toUpperCase().includes('JOSE'))) {
          pac = 'JOSÉ CALIXTO';
        }
        const periodoInicialVal = getVal(['PERÍODO INICIAL', 'Periodo Inicial', 'Data Inicial', 'Inicio', 'Início', 'Data de Inicio', 'Data de Início']);
        const periodoFinalVal = getVal(['PERÍODO FINAL', 'Periodo Final', 'Data Final', 'Fim', 'Data de Fim', 'Término', 'Termino']);
        const numEnsaios = Number(getVal(['Nº DE ENSAIOS', 'Ensaios', 'Nº Ensaios', 'Quantidade', 'Nº de Ensaios', 'Numero de Ensaios', 'Num Ensaios']) || 0);

        const statusVal = cleanString(getVal(['status', 'Status', 'Situação', 'Situacao']) || 'ABERTO');
        const recebidoPor = cleanString(getVal(['RECEBIDO POR', 'Recebido Por', 'Responsável', 'Responsavel', 'Cadastrado Por']) || 'Sistema');
        const recebidoEmVal = getVal(['recebido em', 'Recebido Em', 'Data Recebimento', 'Data de Recebimento', 'RecebidoNoDia']);
        
        const lidoPor = cleanString(getVal(['LIDO POR', 'Lido Por', 'Regularizado Por', 'Lido', 'LidoPor']));
        const lidoEmVal = getVal(['lido em', 'Lido Em', 'Regularizado Em', 'Data Regularização', 'Data Regularizacao', 'Data Lido', 'LidoEm']);
        
        const conferidoPor = cleanString(getVal(['CONFERIDO POR', 'Conferido Por', 'Fechado Por', 'Informado Por', 'Informado', 'Conferido', 'ConferidoPor', 'InformadoPor']));
        const conferidoEmVal = getVal(['conferido em', 'Conferido Em', 'Fechado Em', 'Data Fechamento', 'Informado Em', 'InformadoEm', 'ConferidoEm']);
        
        const pInicial = parseExcelDate(periodoInicialVal);
        const pFinal = parseExcelDate(periodoFinalVal);
        const rEm = parseExcelDate(recebidoEmVal);
        const lEm = parseExcelDate(lidoEmVal);
        const cEm = parseExcelDate(conferidoEmVal);

        let status = 'ABERTO';
        const rawStatus = statusVal.toUpperCase().trim();
        if (rawStatus === 'ABERTO' || rawStatus === 'EM ABERTO' || rawStatus === 'ABERTA') {
          status = 'ABERTO';
        } else if (rawStatus === 'ALERTA') {
          status = 'ALERTA';
        } else if (rawStatus === 'ATRASO') {
          status = 'ATRASO';
        } else if (rawStatus === 'EM ANDAMENTO' || rawStatus === 'ANDAMENTO') {
          status = 'EM ANDAMENTO';
        } else if (rawStatus === 'FINALIZADO' || rawStatus === 'CONCLUÍDO' || rawStatus === 'CONCLUIDO' || rawStatus === 'FINALIZADA') {
          status = 'FINALIZADO';
        } else if (rawStatus) {
          status = rawStatus;
        }

        if (conferidoPor && conferidoPor.trim() !== '') {
          status = 'FINALIZADO';
        } else if (status === 'FINALIZADO') {
          status = 'ABERTO';
        }

        const finalPInicial = pInicial || Timestamp.now();
        const finalREm = rEm || Timestamp.now();
        const importDeadlineEval = evaluatePacDeliveryDeadline(finalPInicial, finalREm, rawStatus === 'ATRASO' ? true : undefined);

        const batchData = {
          pac,
          periodoInicial: finalPInicial,
          periodoFinal: pFinal || Timestamp.now(),
          numEnsaios,
          status,
          recebidoPor,
          recebidoEm: finalREm,
          lidoPor,
          lidoEm: lEm || (lidoPor ? Timestamp.now() : null),
          conferidoPor,
          conferidoEm: cEm || (conferidoPor ? Timestamp.now() : null),
          ensaioForaDoPrazo: importDeadlineEval.isLate
        };

        if (batchData.pac) {
          parsedItems.push(batchData);
        }
      }

      if (parsedItems.length === 0) {
        throw new Error('Nenhum lote válido com coluna "PAC" foi encontrado.');
      }

      const previewWithDuplicates = checkDuplicates(parsedItems, batches);
      setPreviewItems(previewWithDuplicates);
      setImportStatus({ 
        type: 'info', 
        message: `Sucesso! Extraímos ${previewWithDuplicates.length} registros. Por favor, revise os dados e decida sobre as duplicatas abaixo antes de salvar.` 
      });
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `Erro ao analisar dados: ${err.message}` });
    } finally {
      setIsImporting(false);
    }
  };

  const processExcelData = async (buffer: ArrayBuffer, isCsv = false) => {
    try {
      let data: any[] = [];
      if (isCsv) {
        data = parseCSV(buffer);
      } else {
        const workbook = read(buffer, { cellDates: true });
        
        let targetSheetName = workbook.SheetNames.find(name => 
          name.trim().toUpperCase() === 'PRODUÇÃO' || 
          name.trim().toUpperCase() === 'PRODUCAO'
        );

        if (!targetSheetName) {
          if (workbook.SheetNames.length === 1) {
            targetSheetName = workbook.SheetNames[0];
          } else {
            throw new Error('A aba "PRODUÇÃO" não foi encontrada na planilha.');
          }
        }

        const worksheet = workbook.Sheets[targetSheetName];
        data = utils.sheet_to_json(worksheet) as any[];
      }

      await processParsedDataObjects(data);
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `Erro ao processar arquivo: ${err.message}` });
      setIsImporting(false);
    }
  };

  const handlePastedImport = async () => {
    if (!pastedInput.trim()) return;
    setIsImporting(true);
    setImportStatus({ type: 'info', message: 'Analisando dados colados...' });

    try {
      const lines = pastedInput.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length === 0) {
        throw new Error('Texto colado está vazio.');
      }

      const parsedRows = lines.map(line => {
        if (line.includes('\t')) {
          return line.split('\t');
        } else if (line.includes(';')) {
          return line.split(';');
        } else if (line.includes(',')) {
          return line.split(',');
        } else {
          const parts = line.split(/\s{2,}/);
          if (parts.length > 1) {
            return parts;
          }
          return [line];
        }
      });

      const firstLine = parsedRows[0];
      const isHeader = firstLine.some(cell => {
        const c = String(cell).toLowerCase().trim();
        return c === 'pac' || c.includes('período') || c.includes('periodo') || c.includes('ensaios') || c === 'status' || c.includes('recebido');
      });

      let headers: string[] = [];
      let rawData: string[][] = [];

      if (isHeader) {
        headers = firstLine.map(h => h.trim());
        rawData = parsedRows.slice(1);
      } else {
        headers = ['PAC', 'PERÍODO INICIAL', 'PERÍODO FINAL', 'Nº DE ENSAIOS', 'status', 'RECEBIDO POR', 'recebido em', 'LIDO POR', 'lido em', 'CONFERIDO POR', 'conferido em'];
        rawData = parsedRows;
      }

      const dataObjects = rawData.map(row => {
        const obj: any = {};
        headers.forEach((header, idx) => {
          obj[header] = row[idx] !== undefined ? row[idx].trim() : '';
        });
        return obj;
      });

      await processParsedDataObjects(dataObjects);
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `Erro ao processar as células: ${err.message}` });
      setIsImporting(false);
    }
  };

  const handleSavePreview = async () => {
    if (!previewItems || previewItems.length === 0) return;
    setIsSavingPreview(true);
    setImportStatus({ type: 'info', message: 'Salvando lotes no banco de dados...' });

    try {
      let importedCount = 0;
      const foundPacs = new Set<string>();
      const foundCollaborators = new Set<string>();
      const foundStatuses = new Set<string>();

      const batchesToSave = [...previewItems];
      const importedLocalBatches: any[] = [];

      const chunks: any[][] = [];
      for (let i = 0; i < batchesToSave.length; i += 400) {
        chunks.push(batchesToSave.slice(i, i + 400));
      }

      for (const chunk of chunks) {
        if (isLocalMode) {
          chunk.forEach(item => {
            const newId = 'local-imp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
            const { id, isDuplicate, duplicateType, key, ...cleanData } = item;
            importedLocalBatches.push({ id: newId, ...cleanData } as Batch);
            importedCount++;

            if (cleanData.pac) foundPacs.add(cleanData.pac);
            if (cleanData.recebidoPor) foundCollaborators.add(cleanData.recebidoPor);
            if (cleanData.lidoPor) foundCollaborators.add(cleanData.lidoPor);
            if (cleanData.conferidoPor) foundCollaborators.add(cleanData.conferidoPor);
            if (cleanData.status) foundStatuses.add(cleanData.status);
          });
        } else {
          const batch = writeBatch(db);
          chunk.forEach(item => {
            const { id, isDuplicate, duplicateType, key, ...cleanData } = item;
            const docRef = doc(collection(db, 'batches'));
            batch.set(docRef, { ...cleanData, createdAt: Timestamp.now() });
            importedCount++;

            if (cleanData.pac) foundPacs.add(cleanData.pac);
            if (cleanData.recebidoPor) foundCollaborators.add(cleanData.recebidoPor);
            if (cleanData.lidoPor) foundCollaborators.add(cleanData.lidoPor);
            if (cleanData.conferidoPor) foundCollaborators.add(cleanData.conferidoPor);
            if (cleanData.status) foundStatuses.add(cleanData.status);
          });
          await batch.commit().catch(err => {
            handleFirestoreError(err, OperationType.WRITE, 'batches');
          });
        }
      }

      if (isLocalMode) {
        const currentPacNames = pacs.map((p: any) => p.name.trim().toLowerCase());
        const currentCollabNames = collaborators.map((c: any) => c.name.trim().toLowerCase());
        const currentStatusNames = statuses.map((s: any) => s.name.trim().toLowerCase());

        let pacsUpdated = false;
        let collabsUpdated = false;
        let statusesUpdated = false;

        const newPacsList = [...pacs];
        const newCollabsList = [...collaborators];
        const newStatusesList = [...statuses];

        foundPacs.forEach(p => {
          if (p && !currentPacNames.includes(p.toLowerCase())) {
            newPacsList.push({ id: 'local-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5), name: p });
            pacsUpdated = true;
          }
        });

        foundCollaborators.forEach(c => {
          if (c && !currentCollabNames.includes(c.toLowerCase())) {
            newCollabsList.push({ id: 'local-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5), name: c });
            collabsUpdated = true;
          }
        });

        foundStatuses.forEach(s => {
          if (s && !currentStatusNames.includes(s.toLowerCase())) {
            newStatusesList.push({ id: 'local-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5), name: s, color: '#6B7280' });
            statusesUpdated = true;
          }
        });

        if (pacsUpdated) {
          const sorted = newPacsList.sort((a, b) => a.name.localeCompare(b.name));
          setPacs(sorted);
          localStorage.setItem('lotes_pacs', JSON.stringify(sorted));
        }
        if (collabsUpdated) {
          const sorted = newCollabsList.sort((a, b) => a.name.localeCompare(b.name));
          setCollaborators(sorted);
          localStorage.setItem('lotes_collaborators', JSON.stringify(sorted));
        }
        if (statusesUpdated) {
          const sorted = newStatusesList.sort((a, b) => a.name.localeCompare(b.name));
          setStatuses(sorted);
          localStorage.setItem('lotes_statuses', JSON.stringify(sorted));
        }

        const finalizedLocalBatches = importedLocalBatches.map((b: any) => ({
          ...b,
          periodoInicial: parseLocalTimestamp(b.periodoInicial),
          periodoFinal: parseLocalTimestamp(b.periodoFinal),
          recebidoEm: parseLocalTimestamp(b.recebidoEm),
          lidoEm: parseLocalTimestamp(b.lidoEm),
          conferidoEm: parseLocalTimestamp(b.conferidoEm),
          createdAt: LocalTimestamp.now()
        }));
        const updated = [...finalizedLocalBatches, ...batches];
        setBatches(updated);
        localStorage.setItem('lotes_batches', JSON.stringify(updated));
      } else {
        const currentPacNames = pacs.map((p: any) => p.name.trim().toLowerCase());
        const currentCollabNames = collaborators.map((c: any) => c.name.trim().toLowerCase());
        const currentStatusNames = statuses.map((s: any) => s.name.trim().toLowerCase());

        for (const p of foundPacs) {
          if (p && !currentPacNames.includes(p.toLowerCase())) {
            await addDoc(collection(db, 'pacs'), { name: p });
          }
        }

        for (const c of foundCollaborators) {
          if (c && !currentCollabNames.includes(c.toLowerCase())) {
            await addDoc(collection(db, 'collaborators'), { name: c });
          }
        }

        for (const s of foundStatuses) {
          if (s && !currentStatusNames.includes(s.toLowerCase())) {
            await addDoc(collection(db, 'statuses'), { name: s, color: '#6B7280' });
          }
        }
      }

      setImportStatus({ type: 'success', message: `${importedCount} lotes importados e salvos com sucesso!` });
      setPreviewItems(null);
      setPastedInput('');
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `Erro ao salvar os lotes: ${err.message}` });
    } finally {
      setIsSavingPreview(false);
    }
  };

  const handleLinkImport = async () => {
    if (!importLink) return;
    setIsImporting(true);
    setImportStatus({ type: 'info', message: 'Baixando planilha...' });

    try {
      const directLink = handleOneDriveLink(importLink);
      const response = await fetch(directLink);
      if (!response.ok) throw new Error('Não foi possível baixar o arquivo. Verifique se o link é público e permite download direto.');
      
      const buffer = await response.arrayBuffer();
      const isCsv = importLink.toLowerCase().split('?')[0].split('#')[0].endsWith('.csv');
      await processExcelData(buffer, isCsv);
    } catch (err: any) {
      setImportStatus({ 
        type: 'error', 
        message: 'Erro ao baixar link. Dica: Use a opção de upload direto se o link do OneDrive estiver bloqueado por CORS.' 
      });
      setIsImporting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus({ type: 'info', message: 'Lendo arquivo...' });

    try {
      const buffer = await file.arrayBuffer();
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      await processExcelData(buffer, isCsv);
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `Erro no upload: ${err.message}` });
      setIsImporting(false);
    }
  };

  const handleDeleteAllBatches = async () => {
    setIsDeletingAll(true);
    try {
      if (isLocalMode) {
        setBatches([]);
        localStorage.setItem('lotes_batches', JSON.stringify([]));
        setImportStatus({ type: 'success', message: 'Todos os lotes foram excluídos com sucesso.' });
        setShowDeleteAllConfirm(false);
        return;
      }
      const snapshot = await getDocs(collection(db, 'batches'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      setImportStatus({ type: 'success', message: 'Todos os lotes foram excluídos com sucesso.' });
      setShowDeleteAllConfirm(false);
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `Erro ao excluir lotes: ${err.message}` });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleAdd = async () => {
    if (!newItemName) return;
    const collectionName = 
      activeConfig === 'pacs' ? 'pacs' : 
      activeConfig === 'collabs' ? 'collaborators' : 
      activeConfig === 'status' ? 'statuses' : 
      activeConfig === 'notification_types' ? 'notification_types' : 'non_conformities_configs';
    if (isLocalMode) {
      const newItem: any = {
        id: 'local-cfg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
        name: newItemName
      };
      if (collectionName === 'pacs') {
        newItem.razaoSocial = newPacRazaoSocial;
        newItem.cnpj = newPacCnpj;
        const sorted = [...pacs, newItem].sort((a, b) => a.name.localeCompare(b.name));
        setPacs(sorted);
        localStorage.setItem('lotes_pacs', JSON.stringify(sorted));
      } else if (collectionName === 'collaborators') {
        const sorted = [...collaborators, newItem].sort((a, b) => a.name.localeCompare(b.name));
        setCollaborators(sorted);
        localStorage.setItem('lotes_collaborators', JSON.stringify(sorted));
      } else if (collectionName === 'statuses') {
        const sorted = [...statuses, newItem].sort((a, b) => a.name.localeCompare(b.name));
        setStatuses(sorted);
        localStorage.setItem('lotes_statuses', JSON.stringify(sorted));
      } else if (collectionName === 'notification_types') {
        const sorted = [...notificationTypes, newItem].sort((a, b) => a.name.localeCompare(b.name));
        setNotificationTypes(sorted);
        localStorage.setItem('lotes_notification_types', JSON.stringify(sorted));
      } else {
        const selectedFraming = framings.find((f: any) => f.id === selectedFramingId);
        const newItemWithFraming = {
          ...newItem,
          framingId: selectedFramingId || '',
          framingNumber: selectedFraming ? selectedFraming.number : '',
          framingDescription: selectedFraming ? selectedFraming.description : ''
        };
        const sorted = [...nonConformitiesConfigs, newItemWithFraming].sort((a, b) => a.name.localeCompare(b.name));
        setNonConformitiesConfigs(sorted);
        localStorage.setItem('lotes_non_conformities_configs', JSON.stringify(sorted));
      }
      setNewItemName('');
      setSelectedFramingId('');
      setNewPacRazaoSocial('');
      setNewPacCnpj('');
      return;
    }
    try {
      const dataToAdd: any = { name: newItemName };
      if (collectionName === 'pacs') {
        dataToAdd.razaoSocial = newPacRazaoSocial;
        dataToAdd.cnpj = newPacCnpj;
      }
      if (collectionName === 'non_conformities_configs') {
        const selectedFraming = framings.find((f: any) => f.id === selectedFramingId);
        dataToAdd.framingId = selectedFramingId || '';
        dataToAdd.framingNumber = selectedFraming ? selectedFraming.number : '';
        dataToAdd.framingDescription = selectedFraming ? selectedFraming.description : '';
      }
      await addDoc(collection(db, collectionName), dataToAdd);
      setNewItemName('');
      setSelectedFramingId('');
      setNewPacRazaoSocial('');
      setNewPacCnpj('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, collectionName);
    }
  };

  const handleCopyNotificationType = async (item: any) => {
    const copyName = `${item.name} - Cópia`;
    const templatesCopy = item.templates ? JSON.parse(JSON.stringify(item.templates)) : null;

    if (isLocalMode) {
      const copiedItem = {
        id: 'local-cfg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
        name: copyName,
        templates: templatesCopy
      };
      const sorted = [...notificationTypes, copiedItem].sort((a, b) => a.name.localeCompare(b.name));
      setNotificationTypes(sorted);
      localStorage.setItem('lotes_notification_types', JSON.stringify(sorted));
      return;
    }

    try {
      await addDoc(collection(db, 'notification_types'), {
        name: copyName,
        templates: templatesCopy
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notification_types');
    }
  };

  const handleDelete = (id: string) => {
    const collectionName = 
      activeConfig === 'pacs' ? 'pacs' : 
      activeConfig === 'collabs' ? 'collaborators' : 
      activeConfig === 'status' ? 'statuses' : 
      activeConfig === 'notification_types' ? 'notification_types' : 'non_conformities_configs';
    setConfigToDelete({ type: collectionName, id });
  };

  const handleEdit = (item: any) => {
    setEditingId(item.id);
    setEditingValue(item.name);
    if (activeConfig === 'non_conformities') {
      setEditingConfigFramingId(item.framingId || '');
    }
    if (activeConfig === 'pacs') {
      setEditingPacRazaoSocial(item.razaoSocial || '');
      setEditingPacCnpj(item.cnpj || '');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingValue.trim()) return;
    const collectionName = 
      activeConfig === 'pacs' ? 'pacs' : 
      activeConfig === 'collabs' ? 'collaborators' : 
      activeConfig === 'status' ? 'statuses' : 
      activeConfig === 'notification_types' ? 'notification_types' : 'non_conformities_configs';
    
    let extraFields: any = undefined;
    if (collectionName === 'non_conformities_configs') {
      const selectedFraming = framings.find((f: any) => f.id === editingConfigFramingId);
      extraFields = {
        framingId: editingConfigFramingId || '',
        framingNumber: selectedFraming ? selectedFraming.number : '',
        framingDescription: selectedFraming ? selectedFraming.description : ''
      };
    }
    if (collectionName === 'pacs') {
      extraFields = {
        razaoSocial: editingPacRazaoSocial,
        cnpj: editingPacCnpj
      };
    }

    try {
      await onUpdate(collectionName, editingId, editingValue.trim(), extraFields);
      setEditingId(null);
      setEditingValue('');
      setEditingConfigFramingId('');
      setEditingPacRazaoSocial('');
      setEditingPacCnpj('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `${collectionName}/${editingId}`);
    }
  };

  const handleAddFraming = async () => {
    if (!newFramingNumber.trim() || !newFramingDescription.trim()) return;
    
    if (isLocalMode) {
      const newFraming = {
        id: 'local-framing-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
        number: newFramingNumber.trim(),
        description: newFramingDescription.trim()
      };
      const updated = [...framings, newFraming].sort((a, b) => a.number.localeCompare(b.number));
      setFramings(updated);
      localStorage.setItem('lotes_framings', JSON.stringify(updated));
      setNewFramingNumber('');
      setNewFramingDescription('');
      return;
    }
    
    try {
      await addDoc(collection(db, 'framings'), {
        number: newFramingNumber.trim(),
        description: newFramingDescription.trim()
      });
      setNewFramingNumber('');
      setNewFramingDescription('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'framings');
    }
  };

  const handleStartEditFraming = (f: any) => {
    setEditingFramingId(f.id);
    setEditingFramingNumber(f.number);
    setEditingFramingDescription(f.description);
  };

  const handleSaveEditFraming = async () => {
    if (!editingFramingId || !editingFramingNumber.trim() || !editingFramingDescription.trim()) return;
    
    if (isLocalMode) {
      const updated = framings.map(f => f.id === editingFramingId ? {
        ...f,
        number: editingFramingNumber.trim(),
        description: editingFramingDescription.trim()
      } : f).sort((a, b) => a.number.localeCompare(b.number));
      
      setFramings(updated);
      localStorage.setItem('lotes_framings', JSON.stringify(updated));
      
      // Update linked values in non_conformities_configs
      const updatedNCConfigs = nonConformitiesConfigs.map((nc: any) => {
        if (nc.framingId === editingFramingId) {
          return {
            ...nc,
            framingNumber: editingFramingNumber.trim(),
            framingDescription: editingFramingDescription.trim()
          };
        }
        return nc;
      });
      setNonConformitiesConfigs(updatedNCConfigs);
      localStorage.setItem('lotes_non_conformities_configs', JSON.stringify(updatedNCConfigs));

      setEditingFramingId(null);
      setEditingFramingNumber('');
      setEditingFramingDescription('');
      return;
    }
    
    try {
      await updateDoc(doc(db, 'framings', editingFramingId), {
        number: editingFramingNumber.trim(),
        description: editingFramingDescription.trim()
      });
      
      // Also update matching configs in Firestore
      const matching = nonConformitiesConfigs.filter((nc: any) => nc.framingId === editingFramingId);
      for (const m of matching) {
        await updateDoc(doc(db, 'non_conformities_configs', m.id), {
          framingNumber: editingFramingNumber.trim(),
          framingDescription: editingFramingDescription.trim()
        });
      }

      setEditingFramingId(null);
      setEditingFramingNumber('');
      setEditingFramingDescription('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `framings/${editingFramingId}`);
    }
  };

  const handleDeleteFraming = async (id: string) => {
    if (isLocalMode) {
      const updated = framings.filter(f => f.id !== id);
      setFramings(updated);
      localStorage.setItem('lotes_framings', JSON.stringify(updated));
      
      // Remove linked enquadramento from configs
      const updatedNCConfigs = nonConformitiesConfigs.map((nc: any) => {
        if (nc.framingId === id) {
          return {
            ...nc,
            framingId: '',
            framingNumber: '',
            framingDescription: ''
          };
        }
        return nc;
      });
      setNonConformitiesConfigs(updatedNCConfigs);
      localStorage.setItem('lotes_non_conformities_configs', JSON.stringify(updatedNCConfigs));
      return;
    }
    
    try {
      await deleteDoc(doc(db, 'framings', id));
      
      // Also clear fields in matched docs
      const matching = nonConformitiesConfigs.filter((nc: any) => nc.framingId === id);
      for (const m of matching) {
        await updateDoc(doc(db, 'non_conformities_configs', m.id), {
          framingId: '',
          framingNumber: '',
          framingDescription: ''
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `framings/${id}`);
    }
  };

  const sortedNonConformitiesConfigs = [...(nonConformitiesConfigs || [])].sort((a, b) => 
    (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' })
  );

  const sortedFramings = [...(framings || [])].sort((a, b) => {
    const numCompare = (a.number || '').localeCompare(b.number || '', 'pt-BR', { numeric: true, sensitivity: 'base' });
    if (numCompare !== 0) return numCompare;
    return (a.description || '').localeCompare(b.description || '', 'pt-BR', { sensitivity: 'base' });
  });

  const baseItems = 
    activeConfig === 'pacs' ? pacs : 
    activeConfig === 'collabs' ? collaborators : 
    activeConfig === 'status' ? statuses : 
    activeConfig === 'notification_types' ? notificationTypes : sortedNonConformitiesConfigs;

  const items = baseItems.filter((item: any) => {
    if (activeConfig === 'non_conformities' && motivoSearch.trim() !== '') {
      const q = motivoSearch.toLowerCase().trim();
      return (item.name || '').toLowerCase().includes(q) || 
             (item.framingNumber || '').toLowerCase().includes(q) || 
             (item.framingDescription || '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="bg-white rounded-[32px] p-8 border border-[#e5e5e0]">
      <div className="flex flex-wrap gap-2.5 mb-8">
        <button 
          onClick={() => setActiveConfig('pacs')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold", activeConfig === 'pacs' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          PACs
        </button>
        <button 
          onClick={() => setActiveConfig('collabs')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold", activeConfig === 'collabs' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          Colaboradores
        </button>
        <button 
          onClick={() => setActiveConfig('status')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold", activeConfig === 'status' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          Status
        </button>
        <button 
          onClick={() => setActiveConfig('non_conformities')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold", activeConfig === 'non_conformities' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          Motivos de Não-Conformidade
        </button>
        <button 
          onClick={() => setActiveConfig('notification_types')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold", activeConfig === 'notification_types' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          Tipos de Notificações
        </button>
        <button 
          onClick={() => setActiveConfig('deadlines')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2", activeConfig === 'deadlines' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          <Calendar size={16} />
          Prazos e Recessos
          {Array.isArray(deadlineExtensions) && deadlineExtensions.filter((e: any) => e.active !== false).length > 0 && (
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-extrabold",
              activeConfig === 'deadlines' ? "bg-white/20 text-white" : "bg-teal-600 text-white"
            )}>
              {deadlineExtensions.filter((e: any) => e.active !== false).length}
            </span>
          )}
        </button>
        <button 
          onClick={() => setActiveConfig('import')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2", activeConfig === 'import' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          <FileSpreadsheet size={16} />
          Importar
        </button>
        <button 
          onClick={() => setActiveConfig('branding')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2", activeConfig === 'branding' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          <Upload size={16} />
          Identidade Visual
        </button>
        <button 
          onClick={() => setActiveConfig('security')}
          className={cn("px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2", activeConfig === 'security' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]")}
        >
          <Lock size={16} />
          Segurança
        </button>
      </div>

      {activeConfig === 'import' ? (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-[#f5f5f0] p-6 rounded-2xl border border-dashed border-[#5A5A40]/20">
            <h4 className="font-display font-bold tracking-tight text-lg mb-2">Importar de Planilha</h4>
              <p className="text-sm text-[#5A5A40]/70 mb-6">
                Carregue seus dados iniciais via link do OneDrive ou arquivo local (.xlsx, .xls, .csv).
                O sistema irá ler <strong>somente a aba nomeada como "PRODUÇÃO"</strong>.
                A planilha deve conter as colunas: <span className="font-mono font-bold">PAC, PERÍODO INICIAL, PERÍODO FINAL, Nº DE ENSAIOS, status, RECEBIDO POR, recebido em, LIDO POR, lido em, CONFERIDO POR, conferido em</span>.
                Se os campos de fluxo (Lido e Informado) estiverem preenchidos, o status será automaticamente definido como <span className="font-bold text-emerald-600">FINALIZADO</span>.
              </p>

            <div className="space-y-6">
              {/* Link Import */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase opacity-50">Link do OneDrive / Web</label>
                <div className="flex gap-2">
                  <input 
                    type="url" 
                    placeholder="https://onedrive.live.com/..."
                    className="flex-1 p-3 bg-white border border-[#e5e5e0] rounded-xl text-sm"
                    value={importLink}
                    onChange={e => setImportLink(e.target.value)}
                  />
                  <button 
                    onClick={handleLinkImport}
                    disabled={isImporting || !importLink}
                    className="bg-[#5A5A40] text-white px-6 rounded-xl font-bold hover:bg-[#4a4a30] disabled:opacity-50 flex items-center gap-2"
                  >
                    {isImporting ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                    Importar Link
                  </button>
                </div>
              </div>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#e5e5e0]"></div></div>
                <div className="relative flex justify-center text-xs uppercase font-bold text-[#5A5A40]/40"><span className="bg-[#f5f5f0] px-2">Ou</span></div>
              </div>

              {/* File Upload */}
              <div className="flex justify-center">
                <label className="w-full cursor-pointer group">
                  <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-[#e5e5e0] rounded-2xl group-hover:border-[#5A5A40]/40 transition-all bg-white">
                    <Upload className="text-[#5A5A40]/40 group-hover:text-[#5A5A40] mb-2 transition-colors" size={32} />
                    <span className="text-sm font-medium text-[#5A5A40]/60 group-hover:text-[#5A5A40]">Clique para selecionar arquivo (.xlsx, .xls, .csv)</span>
                    <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} disabled={isImporting} />
                  </div>
                </label>
              </div>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#e5e5e0]"></div></div>
                <div className="relative flex justify-center text-xs uppercase font-bold text-[#5A5A40]/40"><span className="bg-[#f5f5f0] px-2">Ou se preferir</span></div>
              </div>

              {/* Paste Cells Option */}
              <div className="space-y-2 bg-white p-6 rounded-2xl border border-[#e5e5e0]">
                <label className="text-xs font-bold uppercase text-[#5A5A40]">Colar Células Copiadas do Excel / Sheets</label>
                <p className="text-xs text-[#5A5A40]/60">
                  Selecione as células na sua planilha, copie (Ctrl+C) e cole (Ctrl+V) no campo abaixo.
                  Utilizamos as colunas parâmetros de cabeçalho: <span className="font-mono bg-gray-100 px-1 rounded text-[11px]">PAC, PERÍODO INICIAL, PERÍODO FINAL, Nº DE ENSAIOS, status, RECEBIDO POR, recebido em, LIDO POR, lido em, CONFERIDO POR, conferido em</span>.
                </p>
                <textarea
                  rows={5}
                  placeholder="Cole aqui... Exemplo:&#10;LOTE-001	01/01/2026	10/01/2026	15	ABERTO	Operador 1"
                  className="w-full p-4 bg-[#f5f5f0] border border-[#e5e5e0] rounded-xl text-xs font-mono focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none"
                  value={pastedInput}
                  onChange={e => setPastedInput(e.target.value)}
                />
                <button
                  onClick={handlePastedImport}
                  disabled={isImporting || !pastedInput.trim()}
                  className="w-full bg-[#5A5A40] text-white py-3 rounded-xl font-bold hover:bg-[#4a4a30] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isImporting ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                  Analisar e Importar Células Coladas
                </button>
              </div>

              {/* Review and Preview Screen */}
              {previewItems && (
                <div className="bg-white rounded-2xl p-6 border border-[#e5e5e0] space-y-4 animate-in zoom-in-95 duration-200">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#e5e5e0] pb-4">
                    <div>
                      <h4 className="font-display font-bold text-lg text-[#5A5A40]">Revisão de Dados Extraídos</h4>
                      <p className="text-sm text-[#5A5A40]/70">
                        Lotes identificados: <span className="font-bold text-[#5A5A40]">{previewItems.length}</span>. 
                        Duplicatas: <span className="font-bold text-red-600">{previewItems.filter(item => item.isDuplicate).length}</span>.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                      {previewItems.some(item => item.isDuplicate) && (
                        <button
                          onClick={handleAutoRemoveDuplicates}
                          className="flex-1 sm:flex-initial bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center justify-center gap-1"
                          title="Filtra duplicados e mantém apenas cópias únicas não salvas"
                        >
                          <Trash2 size={14} />
                          Remover Duplicados
                        </button>
                      )}
                      <button
                        onClick={handleSavePreview}
                        disabled={isSavingPreview}
                        className="flex-1 sm:flex-initial bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {isSavingPreview ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                        Salvar Lotes no Banco ({previewItems.length})
                      </button>
                      <button
                        onClick={() => {
                          setPreviewItems(null);
                          setImportStatus(null);
                        }}
                        className="flex-1 sm:flex-initial bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold px-3 py-2 rounded-xl transition-all"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>

                  <div className="border border-[#e5e5e0] rounded-xl overflow-hidden">
                    <div className="max-h-96 overflow-y-auto overflow-x-auto">
                      <table className="min-w-full divide-y divide-[#e5e5e0] text-xs text-left">
                        <thead className="bg-[#f5f5f0] text-[#5A5A40] font-bold sticky top-0 z-10">
                          <tr>
                            <th className="p-3">PAC</th>
                            <th className="p-3">Período Inicial</th>
                            <th className="p-3">Período Final</th>
                            <th className="p-3">Ensaios</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Tipo Duplicata</th>
                            <th className="p-3 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e5e5e0]">
                          {previewItems.map((item, index) => {
                            const rowId = item.id || `preview-row-${index}`;
                            return (
                              <tr 
                                key={rowId}
                                className={cn(
                                  "hover:bg-gray-50/50 transition-colors",
                                  item.isDuplicate ? "bg-red-50/80" : ""
                                )}
                              >
                                <td className="p-3 font-mono font-bold text-gray-800">{item.pac}</td>
                                <td className="p-3">{formatTimestamp(item.periodoInicial)}</td>
                                <td className="p-3">{formatTimestamp(item.periodoFinal)}</td>
                                <td className="p-3 font-mono">{item.numEnsaios}</td>
                                <td className="p-3">
                                  <span className="bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                                    {item.status}
                                  </span>
                                </td>
                                <td className="p-3">
                                  {item.isDuplicate && (
                                    <span className={cn(
                                      "px-2 py-0.5 text-[9px] rounded-full font-extrabold uppercase tracking-wide",
                                      item.duplicateType === 'database' 
                                        ? "bg-amber-100 text-amber-800 border border-amber-200" 
                                        : "bg-red-100 text-red-800 border border-red-200"
                                    )}>
                                      {item.duplicateType === 'database' ? 'Já no Banco' : 'Repetido na Planilha'}
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-center">
                                  <button
                                    onClick={() => {
                                      const updatedList = previewItems.filter(p => p.id !== item.id);
                                      const reCheckedList = checkDuplicates(
                                        updatedList.map(({isDuplicate, duplicateType, key, ...rest}) => rest), 
                                        batches
                                      );
                                      setPreviewItems(reCheckedList);
                                    }}
                                    className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded-lg transition-colors inline-block"
                                    title="Excluir esta linha para não importar"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Danger Zone */}
              <div className="pt-8 border-t border-[#e5e5e0]">
                <div className="bg-red-50 rounded-2xl p-6 border border-red-100">
                  <div className="flex items-center gap-3 mb-4">
                    <AlertCircle className="text-red-600" size={20} />
                    <h5 className="font-bold text-red-900">Zona de Perigo</h5>
                  </div>
                  <p className="text-sm text-red-700 mb-6">
                    Se a importação falhou ou você deseja recomeçar do zero, você pode excluir todos os lotes cadastrados no sistema. Esta ação é irreversível.
                  </p>
                  
                  {showDeleteAllConfirm ? (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button 
                        onClick={handleDeleteAllBatches}
                        disabled={isDeletingAll}
                        className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isDeletingAll ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                        Sim, Excluir Tudo
                      </button>
                      <button 
                        onClick={() => setShowDeleteAllConfirm(false)}
                        disabled={isDeletingAll}
                        className="flex-1 bg-white text-[#5A5A40] border border-[#e5e5e0] py-3 rounded-xl font-bold hover:bg-[#f5f5f0]"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setShowDeleteAllConfirm(true)}
                      className="w-full bg-white text-red-600 border border-red-200 py-3 rounded-xl font-bold hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <Trash2 size={18} />
                      Excluir Todos os Lotes
                    </button>
                  )}
                </div>
              </div>
            </div>

            {importStatus && (
              <div className={cn(
                "mt-6 p-4 rounded-xl flex items-center gap-3 animate-in zoom-in duration-200",
                importStatus.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : 
                importStatus.type === 'error' ? "bg-red-50 text-red-700 border border-red-100" : 
                "bg-blue-50 text-blue-700 border border-blue-100"
              )}>
                {importStatus.type === 'success' ? <CheckCircle2 size={20} /> : 
                 importStatus.type === 'error' ? <AlertCircle size={20} /> : 
                 <Loader2 className="animate-spin" size={20} />}
                <p className="text-sm font-medium">{importStatus.message}</p>
                {importStatus.type !== 'info' && (
                  <button onClick={() => setImportStatus(null)} className="ml-auto opacity-50 hover:opacity-100"><X size={16} /></button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : activeConfig === 'branding' ? (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300 text-[#1e293b]">
          
          {/* Card 1: Logotipo */}
          <div className="bg-[#f5f5f0] p-6 rounded-2xl border border-dashed border-[#5A5A40]/20 space-y-6">
            <div>
              <h4 className="font-display font-bold tracking-tight text-lg mb-1">Logotipo da Instituição</h4>
              <p className="text-sm text-[#5A5A40]/70">
                Faça o upload do logotipo da sua instituição (por exemplo, IPEM-PR). Esta imagem será exibida nos cabeçalhos de todos os modelos de notificação oficiais gerados pelo sistema.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              <div className="space-y-4">
                <span className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]/80 block">Upload do Logotipo</span>
                <div className="border border-gray-200 bg-white rounded-2xl p-6 shadow-sm flex flex-col gap-6">
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-[#5A5A40]/30 rounded-2xl p-8 bg-gray-50 hover:bg-gray-100/50 transition-all cursor-pointer relative">
                    <Upload size={32} className="text-[#5A5A40]/70 mb-3" />
                    <span className="text-xs font-bold text-gray-700">Arraste a imagem da logo para cá...</span>
                    <span className="text-[10px] text-gray-400 mt-1">ou clique para selecionar do computador</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 2 * 1024 * 1024) {
                          alert("A imagem selecionada é muito grande. Escolha uma imagem de até 2MB.");
                          return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          saveLogoUrl(reader.result as string);
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <span className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]/80 block">Visualização do Logotipo Ativo</span>
                <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm flex flex-col items-center justify-center min-h-[220px]">
                  {logoUrl ? (
                    <div className="space-y-6 text-center w-full">
                      <div className="max-w-[240px] max-h-[100px] border border-gray-100 p-4 rounded-xl bg-gray-50 flex items-center justify-center mx-auto overflow-hidden">
                        <img src={logoUrl} alt="Logo Ativa" className="max-h-[80px] w-auto object-contain" referrerPolicy="no-referrer" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-gray-550 font-medium">Logotipo personalizado ativo com sucesso.</p>
                        <button
                          type="button"
                          onClick={() => saveLogoUrl('')}
                          className="bg-red-50 text-red-650 hover:bg-red-100/60 font-bold text-xs py-2 px-4 rounded-xl transition-all"
                        >
                          Remover Logotipo Personalizado
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-4">
                      <div className="text-xs font-bold bg-gray-100 border border-gray-300 py-2 px-4 rounded-xl text-[#5A5A40] inline-block font-display">
                        IPEM-PR (Texto Padrão)
                      </div>
                      <p className="text-xs text-gray-400 max-w-[240px]">Nenhum logotipo personalizado carregado. O sistema usará o texto padrão "IPEM-PR".</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Assinaturas */}
          <div className="bg-[#f5f5f0] p-6 rounded-2xl border border-dashed border-[#5A5A40]/20 space-y-6">
            <div>
              <h4 className="font-display font-bold tracking-tight text-lg mb-1">Assinaturas Autorizadas</h4>
              <p className="text-sm text-[#5A5A40]/70">
                Cadastre e gerencie as assinaturas digitalizadas dos responsáveis e agentes que assinam as notificações oficiais geradas pelo sistema. Recomenda-se assinaturas com fundo transparente.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Form to Register Signature */}
              <div className="lg:col-span-5 bg-white border border-gray-200 rounded-3xl p-6 shadow-sm space-y-4">
                <h5 className="font-bold text-sm text-[#1e293b] border-b border-gray-100 pb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Upload size={16} className="text-[#5A5A40]" />
                    {editingSigId ? "Alterar Assinatura" : "Cadastrar Assinatura"}
                  </span>
                  {editingSigId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSigId(null);
                        setSigName("");
                        setSigRole("");
                        setSigImage("");
                      }}
                      className="text-[10px] text-[#5A5A40] hover:text-red-500 font-bold uppercase transition-colors"
                      title="Cancelar edição e voltar a cadastrar"
                    >
                      Cancelar
                    </button>
                  )}
                </h5>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!sigName.trim() || !sigRole.trim() || !sigImage) {
                      alert("Por favor, preencha o nome, cargo e selecione a imagem da assinatura.");
                      return;
                    }
                    const currentSigs = Array.isArray(signatures) ? signatures : [];
                    if (editingSigId) {
                      const updated = currentSigs.map((s: any) => 
                        s.id === editingSigId 
                          ? { ...s, name: sigName.trim(), role: sigRole.trim(), imageUrl: sigImage }
                          : s
                      );
                      saveSignatures(updated);
                      setEditingSigId(null);
                    } else {
                      const newSig = {
                        id: 'sig_' + Date.now(),
                        name: sigName.trim(),
                        role: sigRole.trim(),
                        imageUrl: sigImage
                      };
                      saveSignatures([...currentSigs, newSig]);
                    }
                    setSigName('');
                    setSigRole('');
                    setSigImage('');
                  }} 
                  className="space-y-4"
                >
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-gray-500 block">Nome do Signatário</label>
                    <input
                      type="text"
                      className="w-full text-xs font-semibold p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
                      placeholder="Ex: João da Silva"
                      value={sigName}
                      onChange={(e) => setSigName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-gray-500 block">Cargo / Função</label>
                    <input
                      type="text"
                      className="w-full text-xs font-semibold p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
                      placeholder="Ex: Agente Fiscal Metrológico"
                      value={sigRole}
                      onChange={(e) => setSigRole(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-gray-500 block">Imagem da Assinatura Digitalizada</label>
                    
                    {sigImage ? (
                      <div className="space-y-3">
                        <div className="border border-dashed border-gray-200 rounded-xl bg-gray-50 p-4 flex items-center justify-center max-h-[100px] overflow-hidden">
                          <img src={sigImage} alt="Assinatura Previsualização" className="max-h-[85px] w-auto object-contain" />
                        </div>
                        <button
                          type="button"
                          onClick={() => setSigImage('')}
                          className="text-[10px] font-bold text-red-650 hover:bg-red-50 py-1.5 px-3 rounded-lg transition-colors border border-red-250 w-full"
                        >
                          Trocar Imagem
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center border border-dashed border-[#5A5A40]/30 rounded-xl p-6 bg-gray-50 hover:bg-gray-150/40 cursor-pointer relative min-h-[110px] transition-colors">
                        <Upload size={20} className="text-[#5A5A40]/60 mb-1" />
                        <span className="text-[10px] font-bold text-gray-600">Fazer Upload de Assinatura</span>
                        <span className="text-[8px] text-gray-400 mt-0.5">PNG, JPG, BMP até 1MB</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 1 * 1024 * 1024) {
                              alert("A imagem selecionada é muito grande. Escolha uma imagem de até 1MB.");
                              return;
                            }
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setSigImage(reader.result as string);
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-[#5A5A40] text-white hover:bg-[#4a4a30] font-bold text-xs py-2.5 px-4 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 mt-2"
                  >
                    {editingSigId ? (
                      <>
                        <Check size={14} />
                        Salvar Alterações
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        Cadastrar Assinatura
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* List of Registered Signatures */}
              <div className="lg:col-span-7 bg-white border border-gray-200 rounded-3xl p-6 shadow-sm min-h-[380px] flex flex-col">
                <h5 className="font-bold text-sm text-[#1e293b] border-b border-gray-100 pb-2 flex justify-between items-center">
                  <span>Assinaturas Cadastradas ({signatures?.length || 0})</span>
                </h5>

                <div className="flex-1 overflow-y-auto mt-4 max-h-[400px]">
                  {Array.isArray(signatures) && signatures.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {signatures.map((sig: any) => (
                        <div key={sig.id} className="border border-gray-150 rounded-2xl p-4 bg-gray-50 flex flex-col justify-between hover:shadow-sm transition-all relative group">
                          
                          {/* Action Buttons: Edit and Delete */}
                          <div className="absolute top-2 right-2 flex gap-1 bg-white/90 rounded-lg p-0.5 shadow-sm border border-gray-200 backdrop-blur-xs">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSigId(sig.id);
                                setSigName(sig.name);
                                setSigRole(sig.role);
                                setSigImage(sig.imageUrl || '');
                              }}
                              className="p-1 text-[#5A5A40] hover:bg-gray-150 rounded transition-colors"
                              title="Alterar / Substituir Assinatura"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Excluir a assinatura de ${sig.name}?`)) {
                                  saveSignatures((signatures || []).filter((s: any) => s.id !== sig.id));
                                  if (editingSigId === sig.id) {
                                    setEditingSigId(null);
                                    setSigName('');
                                    setSigRole('');
                                    setSigImage('');
                                  }
                                }
                              }}
                              className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="Remover Assinatura"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Signature stamp representation */}
                          <div className="flex flex-col items-center text-center mt-3 mb-1">
                            <div className="h-[60px] flex items-center justify-center mb-1">
                              <img src={sig.imageUrl} alt={sig.name} className="max-h-[55px] max-w-[150px] object-contain" referrerPolicy="no-referrer" />
                            </div>
                            <div className="w-11/12 border-t border-gray-200 pt-1.5 mt-1">
                              <h6 className="font-bold text-[11px] text-gray-800 leading-tight">{sig.name}</h6>
                              <p className="text-[9px] text-gray-400 uppercase font-mono mt-0.5 tracking-tight">{sig.role}</p>
                            </div>
                          </div>

                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16 flex flex-col items-center justify-center h-full text-gray-400">
                      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-2">
                        <Upload size={20} />
                      </div>
                      <p className="text-xs font-semibold">Nenhuma assinatura cadastrada.</p>
                      <p className="text-[10px] text-gray-400 max-w-[200px] mt-1 mx-auto text-center">Cadastre uma assinatura no formulário ao lado para utilizá-la nos documentos oficiais.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      ) : activeConfig === 'security' ? (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300 text-[#3A3A28]">
          <div className="bg-[#f5f5f0] p-6 rounded-2xl border border-dashed border-[#5A5A40]/20 space-y-6">
            <div>
              <h4 className="font-display font-bold tracking-tight text-lg mb-1">Configurações de Segurança e Acesso</h4>
              <p className="text-sm text-[#5A5A40]/70">
                Gerencie as permissões e o controle de acesso às configurações estruturais do sistema de controle de lotes.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              {/* Form de Alterar Senha */}
              <div className="border border-gray-200 bg-white rounded-2xl p-6 shadow-sm space-y-4">
                <h5 className="font-display font-bold text-sm uppercase tracking-wider text-[#5A5A40] flex items-center gap-2">
                  <Lock size={16} />
                  Alterar Senha de Acesso
                </h5>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Defina uma nova senha para proteger o acesso à área de configurações.
                </p>

                <form onSubmit={handleSavePassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Nova Senha</label>
                    <div className="relative">
                      <input 
                        type={showNewPassword ? "text" : "password"}
                        placeholder="Digite a nova senha..."
                        className="w-full bg-[#f5f5f0] hover:bg-[#ebebe5] focus:bg-white border border-[#e5e5e0] focus:border-[#5A5A40] focus:ring-1 focus:ring-[#5A5A40] rounded-xl px-3 py-2.5 text-xs text-[#3A3A28] outline-none transition-all pr-10"
                        value={newPassword}
                        onChange={e => {
                          setNewPassword(e.target.value);
                          if (securityStatus) setSecurityStatus(null);
                        }}
                      />
                      <button 
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-black/5 transition"
                      >
                        {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Confirmar Nova Senha</label>
                    <div className="relative">
                      <input 
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Confirme a nova senha..."
                        className="w-full bg-[#f5f5f0] hover:bg-[#ebebe5] focus:bg-white border border-[#e5e5e0] focus:border-[#5A5A40] focus:ring-1 focus:ring-[#5A5A40] rounded-xl px-3 py-2.5 text-xs text-[#3A3A28] outline-none transition-all pr-10"
                        value={confirmPassword}
                        onChange={e => {
                          setConfirmPassword(e.target.value);
                          if (securityStatus) setSecurityStatus(null);
                        }}
                      />
                      <button 
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-black/5 transition"
                      >
                        {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  {securityStatus && (
                    <div className={cn(
                      "p-3 rounded-xl flex items-center gap-2 text-xs font-medium border",
                      securityStatus.type === 'success' ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100"
                    )}>
                      {securityStatus.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                      <span>{securityStatus.message}</span>
                    </div>
                  )}

                  <button 
                    type="submit"
                    className="w-full px-4 py-2.5 bg-[#5A5A40] hover:bg-[#484833] text-white font-bold text-xs rounded-xl transition-colors shadow-sm cursor-pointer"
                  >
                    Salvar Nova Senha
                  </button>
                </form>
              </div>

              {/* Revogar Permissão */}
              <div className="border border-gray-200 bg-white rounded-2xl p-6 shadow-sm space-y-4">
                <h5 className="font-display font-bold text-sm uppercase tracking-wider text-[#5A5A40] flex items-center gap-2">
                  <Lock size={16} />
                  Controle de Sessão e Bloqueio
                </h5>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Para garantir a segurança dos dados, principalmente em computadores compartilhados ou de uso coletivo, revogue a autorização atual do painel de configurações.
                </p>
                
                <div className="bg-amber-50 border border-amber-100 p-3.5 rounded-xl space-y-2">
                  <p className="text-xs text-amber-800 font-medium">
                    Sua permissão está atualmente <strong>Ativa (Desbloqueada)</strong>.
                  </p>
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    Ao revogar a permissão, o painel será bloqueado imediatamente e será obrigatório digitar a senha novamente na próxima tentativa de acesso.
                  </p>
                </div>

                <button 
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('lotes_config_unlocked');
                    setIsConfigUnlocked(false);
                    setActiveTab('dashboard');
                  }}
                  className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Lock size={14} />
                  Revogar Permissão e Bloquear Painel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : activeConfig === 'deadlines' ? (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300 text-[#1e293b]">
          {/* Cabeçalho Explicativo da Regra de Prazos e Recessos */}
          <div className="bg-[#f5f5f0] p-6 rounded-2xl border border-dashed border-[#5A5A40]/20 space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#e5e5e0] pb-4">
              <div>
                <h4 className="font-display font-bold tracking-tight text-lg text-[#5A5A40] flex items-center gap-2">
                  <Calendar size={20} />
                  Gestão de Prazos, Feriados e Períodos de Recesso (PAC)
                </h4>
                <p className="text-sm text-[#5A5A40]/80 mt-1 max-w-3xl">
                  Em períodos de recesso, feriados prolongados ou paralisações postais, o recebimento dos lotes pode ser comprometido sem culpa do PAC. Cadastre abaixo os intervalos de datas nomeados para que os prazos sejam <strong>desconsiderados</strong> ou <strong>adicionados automaticamente</strong> ao limite de tolerância em todas as áreas do sistema.
                </p>
              </div>
              <button
                type="button"
                disabled={isSyncingBatchDeadlines}
                onClick={() => handleSyncBatchesWithExtensions(deadlineExtensions)}
                className="px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all shrink-0 cursor-pointer disabled:opacity-50"
                title="Atualiza a flag de prazo salvo nos lotes do banco de acordo com as ampliações ativas"
              >
                {isSyncingBatchDeadlines ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Sincronizar Lotes Existentes
              </button>
            </div>

            {/* Resumo da Regra Oficial */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-[#e5e5e0] flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                  10d
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-800">Prazo Base do PAC</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Até 10 dias corridos a partir da Data Inicial do lote para envio pelo PAC.
                  </p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-[#e5e5e0] flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                  +7d
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-800">Tolerância Correios (17d)</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Mais 7 dias para trânsito postal. No Dashboard, o <strong>Alerta</strong> só é sinalizado após passar da data de tolerância.
                  </p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-teal-200 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-xs shrink-0">
                  +Recesso
                </div>
                <div>
                  <p className="text-xs font-bold text-teal-900">Ampliações & Feriados</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Intervalos cadastrados abaixo somam dias à tolerância ou isentam lotes que cruzem o período.
                  </p>
                </div>
              </div>
            </div>

            {extStatusMsg && (
              <div className={cn(
                "p-4 rounded-xl flex items-center gap-3 text-xs font-medium border animate-in fade-in duration-200",
                extStatusMsg.type === 'success'
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-red-50 text-red-800 border-red-200"
              )}>
                {extStatusMsg.type === 'success' ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0" /> : <AlertCircle size={18} className="text-red-600 shrink-0" />}
                <span className="flex-1">{extStatusMsg.message}</span>
                <button type="button" onClick={() => setExtStatusMsg(null)} className="opacity-60 hover:opacity-100">
                  <X size={15} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Formulário de Cadastro / Edição de Ampliação */}
              <div className="lg:col-span-5 bg-white border border-gray-200 rounded-3xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h5 className="font-bold text-sm text-[#1e293b] flex items-center gap-2">
                    <Plus size={16} className="text-[#5A5A40]" />
                    {editingExtId ? 'Editar Ampliação / Recesso' : 'Nova Ampliação de Prazo'}
                  </h5>
                  {editingExtId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingExtId(null);
                        setExtName('');
                        setExtStartDate('');
                        setExtEndDate('');
                        setExtMode('add_days');
                        setExtCustomDays('');
                      }}
                      className="text-[10px] font-bold uppercase text-red-600 hover:underline"
                    >
                      Cancelar Edição
                    </button>
                  )}
                </div>

                <form onSubmit={handleSaveDeadlineExtension} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-gray-500 block">
                      Nome da Inserção / Controle *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Recesso Final de Ano 2025/2026, Carnaval 2026..."
                      className="w-full text-xs font-semibold p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                      value={extName}
                      onChange={e => setExtName(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-gray-500 block">
                        Data Inicial *
                      </label>
                      <input
                        type="date"
                        required
                        className="w-full text-xs font-semibold p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                        value={extStartDate}
                        onChange={e => {
                          const nextStart = e.target.value;
                          setExtStartDate(nextStart);
                          if (nextStart && extEndDate) {
                            const diff = differenceInDays(startOfDay(parseLocalDate(extEndDate)), startOfDay(parseLocalDate(nextStart))) + 1;
                            if (diff > 0) setExtCustomDays(String(diff));
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-gray-500 block">
                        Data Final *
                      </label>
                      <input
                        type="date"
                        required
                        className="w-full text-xs font-semibold p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                        value={extEndDate}
                        onChange={e => {
                          const nextEnd = e.target.value;
                          setExtEndDate(nextEnd);
                          if (extStartDate && nextEnd) {
                            const diff = differenceInDays(startOfDay(parseLocalDate(nextEnd)), startOfDay(parseLocalDate(extStartDate))) + 1;
                            if (diff > 0) setExtCustomDays(String(diff));
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-gray-500 block">
                      Regra de Compensação no Prazo *
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      <label className={cn(
                        "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all text-xs",
                        extMode === 'add_days'
                          ? "bg-teal-50/70 border-teal-500 text-teal-950 font-semibold"
                          : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                      )}>
                        <input
                          type="radio"
                          name="extMode"
                          className="mt-0.5"
                          checked={extMode === 'add_days'}
                          onChange={() => setExtMode('add_days')}
                        />
                        <div>
                          <span className="block font-bold">Adicionar dias ao prazo de tolerância</span>
                          <span className="text-[10px] text-gray-500 font-normal">
                            Soma os dias deste período ao limite de 17 dias dos lotes que cruzarem o intervalo.
                          </span>
                        </div>
                      </label>

                      <label className={cn(
                        "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all text-xs",
                        extMode === 'disregard'
                          ? "bg-teal-50/70 border-teal-500 text-teal-950 font-semibold"
                          : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                      )}>
                        <input
                          type="radio"
                          name="extMode"
                          className="mt-0.5"
                          checked={extMode === 'disregard'}
                          onChange={() => setExtMode('disregard')}
                        />
                        <div>
                          <span className="block font-bold">Desconsiderar prazo no intervalo (Isentar Atraso)</span>
                          <span className="text-[10px] text-gray-500 font-normal">
                            Desconsidera o indicativo de atraso para qualquer lote cujo período ou envio ocorra neste intervalo.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {extMode === 'add_days' && (
                    <div className="space-y-1 bg-teal-50/40 p-3 rounded-xl border border-teal-200/70">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase text-teal-900">
                          Quantidade de Dias a Adicionar
                        </label>
                        {calculatedExtIntervalDays > 0 && (
                          <span className="text-[10px] font-mono text-teal-700">
                            Intervalo selecionado: {calculatedExtIntervalDays} dia(s)
                          </span>
                        )}
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        placeholder={calculatedExtIntervalDays > 0 ? String(calculatedExtIntervalDays) : 'Ex: 10'}
                        className="w-full text-xs font-bold p-2 bg-white border border-teal-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                        value={extCustomDays}
                        onChange={e => setExtCustomDays(e.target.value)}
                      />
                      <p className="text-[10px] text-teal-800/80">
                        Novo limite para lotes afetados: <strong>{17 + (Number(extCustomDays) || calculatedExtIntervalDays || 0)} dias corridos</strong> (10d PAC + 7d Correios + {Number(extCustomDays) || calculatedExtIntervalDays || 0}d ampliação).
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-[#5A5A40] hover:bg-[#4a4a30] text-white font-bold text-xs py-3 px-4 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {editingExtId ? <Check size={15} /> : <Plus size={15} />}
                    {editingExtId ? 'Salvar Alterações na Ampliação' : 'Adicionar Ampliação de Prazo'}
                  </button>
                </form>
              </div>

              {/* Lista de Ampliações Cadastradas */}
              <div className="lg:col-span-7 bg-white border border-gray-200 rounded-3xl p-6 shadow-sm min-h-[420px] flex flex-col">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
                  <div>
                    <h5 className="font-bold text-sm text-[#1e293b]">
                      Ampliações e Períodos Cadastrados ({Array.isArray(deadlineExtensions) ? deadlineExtensions.length : 0})
                    </h5>
                    <p className="text-[11px] text-gray-500">
                      Controle nominal de todos os recessos, feriados e ampliações aplicados aos lotes.
                    </p>
                  </div>
                </div>

                {Array.isArray(deadlineExtensions) && deadlineExtensions.length > 0 ? (
                  <div className="space-y-3 overflow-y-auto max-h-[520px] pr-1">
                    {deadlineExtensions.map((ext: DeadlineExtension) => {
                      const sDate = startOfDay(parseLocalDate(ext.startDate));
                      const eDate = startOfDay(parseLocalDate(ext.endDate));
                      const intervalDays = (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime()))
                        ? Math.max(1, differenceInDays(eDate, sDate) + 1)
                        : 1;
                      const effectiveDaysAdded = ext.mode === 'add_days'
                        ? (ext.customDays && ext.customDays > 0 ? ext.customDays : intervalDays)
                        : 0;

                      // Count how many batches overlap this extension
                      const affectedBatchesCount = (batches || []).filter((b: Batch) => {
                        const pDate = toSafeDate(b.periodoInicial);
                        if (!pDate || isNaN(sDate.getTime()) || isNaN(eDate.getTime())) return false;
                        const bStart = startOfDay(pDate);
                        const rDate = toSafeDate(b.recebidoEm);
                        const baseMax = addDays(bStart, PRAZO_MAXIMO_ENTREGA_PAC_DIAS);
                        const bEnd = rDate ? (isAfter(startOfDay(rDate), baseMax) ? startOfDay(rDate) : baseMax) : baseMax;
                        return !isAfter(bStart, eDate) && !isBefore(bEnd, sDate);
                      }).length;

                      return (
                        <div
                          key={ext.id}
                          className={cn(
                            "p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4",
                            ext.active !== false
                              ? "bg-teal-50/30 border-teal-200/80 hover:border-teal-300"
                              : "bg-gray-50 border-gray-200 opacity-60"
                          )}
                        >
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-display font-bold text-sm text-gray-900">
                                {ext.name}
                              </span>
                              <span className={cn(
                                "text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border",
                                ext.active !== false
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : "bg-gray-200 text-gray-600 border-gray-300"
                              )}>
                                {ext.active !== false ? 'Ativo' : 'Inativo'}
                              </span>
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-lg border",
                                ext.mode === 'disregard'
                                  ? "bg-purple-50 text-purple-800 border-purple-200"
                                  : "bg-teal-100 text-teal-900 border-teal-200"
                              )}>
                                {ext.mode === 'disregard'
                                  ? 'Prazo Desconsiderado (Isento)'
                                  : `+${effectiveDaysAdded} dia(s) no prazo (Limite ${17 + effectiveDaysAdded}d)`}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 font-mono">
                              <span className="flex items-center gap-1">
                                <Calendar size={12} className="text-[#5A5A40]" />
                                {ext.startDate ? format(parseLocalDate(ext.startDate), 'dd/MM/yyyy') : '-'} até {ext.endDate ? format(parseLocalDate(ext.endDate), 'dd/MM/yyyy') : '-'}
                              </span>
                              <span className="text-[11px] text-gray-500 font-sans">
                                • {affectedBatchesCount} lote(s) abrangido(s) no período
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={async () => {
                                const updated = deadlineExtensions.map((item: DeadlineExtension) =>
                                  item.id === ext.id ? { ...item, active: item.active === false ? true : false } : item
                                );
                                await saveDeadlineExtensions(updated);
                              }}
                              className={cn(
                                "px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer",
                                ext.active !== false
                                  ? "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                                  : "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                              )}
                              title={ext.active !== false ? 'Pausar / Desativar esta ampliação' : 'Reativar esta ampliação'}
                            >
                              {ext.active !== false ? 'Desativar' : 'Ativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingExtId(ext.id);
                                setExtName(ext.name);
                                setExtStartDate(ext.startDate);
                                setExtEndDate(ext.endDate);
                                setExtMode(ext.mode);
                                setExtCustomDays(ext.customDays ? String(ext.customDays) : '');
                              }}
                              className="p-2 text-[#5A5A40] hover:bg-white rounded-xl border border-transparent hover:border-gray-200 transition-all cursor-pointer"
                              title="Editar Ampliação"
                            >
                              <Edit3 size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const updated = deadlineExtensions.filter((item: DeadlineExtension) => item.id !== ext.id);
                                await saveDeadlineExtensions(updated);
                                if (editingExtId === ext.id) {
                                  setEditingExtId(null);
                                  setExtName('');
                                  setExtStartDate('');
                                  setExtEndDate('');
                                }
                              }}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                              title="Excluir Ampliação"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-14 text-gray-400">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
                      <Calendar size={22} />
                    </div>
                    <p className="text-xs font-bold text-gray-600">Nenhum período de recesso ou ampliação cadastrado</p>
                    <p className="text-[11px] text-gray-400 max-w-xs mt-1">
                      Utilize o formulário ao lado para registrar recessos de fim de ano, feriados ou ampliações de prazo sempre que necessário.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h3 className="font-display font-bold text-xl text-[#5A5A40] tracking-tight">
              {activeConfig === 'pacs' ? 'Gerenciar PACs' : 
               activeConfig === 'collabs' ? 'Gerenciar Colaboradores' : 
               activeConfig === 'status' ? 'Gerenciar Status' : 
               activeConfig === 'notification_types' ? 'Gerenciar Tipos de Notificações' :
               'Gerenciar Motivos de Não-Conformidade'}
            </h3>
            <p className="text-xs text-[#5A5A40]/60 mt-1">
              Adicione, edite ou exclua opções de preenchimento para as telas de recebimento de lotes.
            </p>
          </div>

          {activeConfig === 'non_conformities' ? (
            <div className="flex flex-col md:flex-row gap-3 mb-6 bg-[#f5f5f0]/40 p-4 rounded-2xl border border-[#e5e5e0]">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-bold uppercase text-[#5A5A40] block">Descrição do Motivo de Não-Conformidade</label>
                <input 
                  type="text" 
                  placeholder="Novo Motivo de Não-Conformidade..."
                  className="w-full p-2.5 bg-white border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                />
              </div>
              <div className="w-full md:w-80 space-y-1">
                <label className="text-[10px] font-bold uppercase text-[#5A5A40] block">Enquadramento Vinculado</label>
                <select
                  className="w-full p-2.5 bg-white border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 font-semibold text-gray-700 h-[42px]"
                  value={selectedFramingId}
                  onChange={e => setSelectedFramingId(e.target.value)}
                >
                  <option value="">-- Sem Enquadramento --</option>
                  {sortedFramings.map((f: any) => (
                    <option key={f.id} value={f.id}>
                      N° {f.number} - {f.description.length > 50 ? f.description.substring(0, 50) + '...' : f.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button 
                  onClick={handleAdd}
                  className="w-full md:w-auto bg-[#5A5A40] text-white px-6 py-2.5 rounded-xl font-bold text-xs hover:bg-[#4a4a30] transition-colors h-[42px]"
                >
                  Adicionar
                </button>
              </div>
            </div>
          ) : activeConfig === 'pacs' ? (
            <div className="flex flex-col md:flex-row gap-3 mb-6 bg-[#f5f5f0]/40 p-4 rounded-2xl border border-[#e5e5e0]">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-bold uppercase text-[#5A5A40] block">Nome Amigável do PAC</label>
                <input 
                  type="text" 
                  placeholder="Ex: PAC Itajaí..."
                  className="w-full p-2.5 bg-white border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-bold uppercase text-[#5A5A40] block">Razão Social</label>
                <input 
                  type="text" 
                  placeholder="Razão Social para Notificações..."
                  className="w-full p-2.5 bg-white border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                  value={newPacRazaoSocial}
                  onChange={e => setNewPacRazaoSocial(e.target.value)}
                />
              </div>
              <div className="w-full md:w-56 space-y-1">
                <label className="text-[10px] font-bold uppercase text-[#5A5A40] block">CNPJ</label>
                <input 
                  type="text" 
                  placeholder="00.000.000/0000-00"
                  className="w-full p-2.5 bg-white border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 font-medium font-mono"
                  value={newPacCnpj}
                  onChange={e => setNewPacCnpj(formatCNPJ(e.target.value))}
                />
              </div>
              <div className="flex items-end">
                <button 
                  onClick={handleAdd}
                  className="w-full md:w-auto bg-[#5A5A40] text-white px-6 py-2.5 rounded-xl font-bold text-xs hover:bg-[#4a4a30] transition-colors h-[42px]"
                >
                  Adicionar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 mb-6">
              <input 
                type="text" 
                placeholder={
                  activeConfig === 'collabs' ? 'Novo Colaborador...' : 
                  activeConfig === 'status' ? 'Novo Status...' : 
                  activeConfig === 'notification_types' ? 'Novo Tipo de Notificação...' :
                  'Novo Motivo de Não-Conformidade...'
                }
                className="flex-1 p-3 bg-[#f5f5f0] border-none rounded-xl focus:ring-2 focus:ring-[#5A5A40]/20 text-sm"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
              />
              <button 
                onClick={handleAdd}
                className="bg-[#5A5A40] text-white px-6 rounded-xl font-bold hover:bg-[#4a4a30]"
              >
                Adicionar
              </button>
            </div>
          )}

          <div className="space-y-2">
            {items.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between p-4 bg-[#f5f5f0] rounded-xl group">
                {editingId === item.id ? (
                  <div className="flex flex-col md:flex-row flex-1 gap-3 bg-white p-3 rounded-lg border border-[#e5e5e0]">
                    <div className="flex-1">
                      <label className="text-[9px] font-bold uppercase text-gray-400 block mb-1">Nome Amigável / Descrição</label>
                      <input 
                        type="text"
                        className="w-full px-3 py-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        autoFocus
                      />
                    </div>
                    {activeConfig === 'pacs' && (
                      <>
                        <div className="flex-1">
                          <label className="text-[9px] font-bold uppercase text-gray-400 block mb-1">Razão Social</label>
                          <input 
                            type="text"
                            className="w-full px-3 py-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                            value={editingPacRazaoSocial}
                            onChange={(e) => setEditingPacRazaoSocial(e.target.value)}
                          />
                        </div>
                        <div className="w-full md:w-48">
                          <label className="text-[9px] font-bold uppercase text-gray-400 block mb-1">CNPJ</label>
                          <input 
                            type="text"
                            className="w-full px-3 py-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-medium font-mono"
                            value={editingPacCnpj}
                            onChange={(e) => setEditingPacCnpj(formatCNPJ(e.target.value))}
                          />
                        </div>
                      </>
                    )}
                    {activeConfig === 'non_conformities' && (
                      <div className="w-full md:w-60">
                        <label className="text-[9px] font-bold uppercase text-gray-400 block mb-1">Enquadramento Vinculado</label>
                        <select
                          className="w-full px-3 py-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-semibold text-gray-700"
                          value={editingConfigFramingId}
                          onChange={e => setEditingConfigFramingId(e.target.value)}
                        >
                          <option value="">-- Sem Enquadramento --</option>
                          {sortedFramings.map((f: any) => (
                            <option key={f.id} value={f.id}>
                              N° {f.number} - {f.description.length > 30 ? f.description.substring(0, 30) + '...' : f.description}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2 items-end justify-end">
                      <button 
                        onClick={handleSaveEdit}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                        title="Salvar"
                      >
                        <Check size={18} />
                      </button>
                      <button 
                        onClick={() => {
                          setEditingId(null);
                          setEditingConfigFramingId('');
                        }}
                        className="p-1.5 text-red-650 hover:bg-red-50 rounded-lg"
                        title="Cancelar"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 pr-4">
                      <span className="font-semibold text-gray-800 text-sm block">{item.name}</span>
                      {activeConfig === 'pacs' && (
                        <div className="mt-1 text-xs text-[#5A5A40]/70 flex flex-wrap gap-3 items-center">
                          {item.razaoSocial && (
                            <span className="inline-flex items-center text-[11px] text-gray-600">
                              <strong className="text-gray-500 mr-1">Razão Social:</strong> {item.razaoSocial}
                            </span>
                          )}
                          {item.cnpj && (
                            <span className="inline-flex items-center text-[11px] font-mono text-gray-600 bg-[#5A5A40]/10 px-1.5 py-0.5 rounded">
                              <strong className="text-gray-500 mr-1 font-sans font-bold text-[10px]">CNPJ:</strong> {item.cnpj}
                            </span>
                          )}
                          {!item.razaoSocial && !item.cnpj && (
                            <span className="text-[10px] text-gray-400 italic">-- Sem Razão Social e CNPJ cadastrados --</span>
                          )}
                        </div>
                      )}
                      {activeConfig === 'non_conformities' && (
                        <div className="mt-1 text-xs text-[#5A5A40]/70 flex flex-wrap gap-2 items-center">
                          {item.framingNumber ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#5A5A40]/10 text-[#5A5A40] font-mono text-[10px] font-bold">
                              Enquadramento: N° {item.framingNumber} - {item.framingDescription}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">-- Nenhum enquadramento vinculado --</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {activeConfig === 'notification_types' && (
                        <button 
                          onClick={() => handleCopyNotificationType(item)}
                          className="p-2 text-[#5A5A40] hover:bg-white rounded-lg transition-all mr-1"
                          title="Copiar Modelo de Notificação"
                        >
                          <Copy size={16} />
                        </button>
                      )}
                      <button 
                        onClick={() => handleEdit(item)}
                        className="p-2 text-[#5A5A40] hover:bg-white rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Edit3 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="p-2 text-red-500 hover:bg-white rounded-lg transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {activeConfig === 'non_conformities' && (
            <div className="mt-12 pt-8 border-t border-[#e5e5e0] space-y-6">
              <div>
                <h4 className="font-display font-bold text-lg text-[#5A5A40] tracking-tight">
                  Gerenciar enquadramentos
                </h4>
                <p className="text-xs text-[#5A5A40]/60 mt-0.5">
                  Associe leis, normas ou portarias de enquadramento legal aos motivos de não-conformidade.
                </p>
              </div>

              {/* Form to add framing */}
              <div className="bg-[#f5f5f0]/40 p-4 rounded-2xl border border-[#e5e5e0] flex flex-col md:flex-row gap-3">
                <div className="w-full md:w-1/3 space-y-1 font-sans">
                  <label className="text-[10px] font-bold uppercase text-[#5A5A40] block">N° do Enquadramento</label>
                  <input
                    type="text"
                    placeholder="Ex: Art. 10..."
                    className="w-full p-2.5 bg-white border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                    value={newFramingNumber}
                    onChange={(e) => setNewFramingNumber(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold uppercase text-[#5A5A40] block">Descrição do Enquadramento</label>
                  <input
                    type="text"
                    placeholder="Ex: Inobservância do padrão regulamentar..."
                    className="w-full p-2.5 bg-white border border-[#e5e5e0] rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                    value={newFramingDescription}
                    onChange={(e) => setNewFramingDescription(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleAddFraming}
                    className="w-full md:w-auto bg-[#5A5A40] text-white px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-[#4a4a30] transition-colors h-[42px]"
                  >
                    Salvar Enquadramento
                  </button>
                </div>
              </div>

              {/* Search query */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="🔍 Buscar enquadramento por número..."
                  className="w-full md:w-80 p-2 py-1.5 bg-[#f5f5f0] border border-transparent rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/10"
                  value={framingSearch}
                  onChange={(e) => setFramingSearch(e.target.value)}
                />
                {framingSearch && (
                  <button
                    onClick={() => setFramingSearch('')}
                    className="text-xs text-red-500 hover:underline font-bold"
                  >
                    Limpar
                  </button>
                )}
              </div>

              {/* Framings list */}
              <div className="space-y-2">
                {sortedFramings.filter((f: any) => {
                  if (!framingSearch.trim()) return true;
                  const query = framingSearch.toLowerCase().trim();
                  return (f.number || '').toLowerCase().includes(query) || (f.description || '').toLowerCase().includes(query);
                }).length > 0 ? (
                  sortedFramings.filter((f: any) => {
                    if (!framingSearch.trim()) return true;
                    const query = framingSearch.toLowerCase().trim();
                    return (f.number || '').toLowerCase().includes(query) || (f.description || '').toLowerCase().includes(query);
                  }).map((f: any) => (
                    <div key={f.id} className="flex items-center justify-between p-3.5 bg-[#f5f5f0]/50 rounded-xl border border-transparent hover:border-[#e5e5e0] transition-all group">
                      {editingFramingId === f.id ? (
                        <div className="flex flex-col md:flex-row flex-1 gap-3 bg-white p-3 rounded-lg border border-[#e5e5e0]">
                          <div className="w-full md:w-1/3">
                            <label className="text-[9px] font-bold uppercase text-gray-400 block mb-1">N°</label>
                            <input
                              type="text"
                              className="w-full px-3 py-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-semibold"
                              value={editingFramingNumber}
                              onChange={(e) => setEditingFramingNumber(e.target.value)}
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[9px] font-bold uppercase text-gray-400 block mb-1">Descrição</label>
                            <input
                              type="text"
                              className="w-full px-3 py-1.5 bg-white border border-[#e5e5e0] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-medium"
                              value={editingFramingDescription}
                              onChange={(e) => setEditingFramingDescription(e.target.value)}
                            />
                          </div>
                          <div className="flex gap-2 items-end justify-end">
                            <button
                              onClick={handleSaveEditFraming}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                              title="Salvar"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => {
                                setEditingFramingId(null);
                                setEditingFramingNumber('');
                                setEditingFramingDescription('');
                              }}
                              className="p-1.5 text-red-650 hover:bg-red-50 rounded-lg"
                              title="Cancelar"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#5A5A40]/10 text-[#5A5A40] font-mono text-[10px] font-bold">
                                N° {f.number}
                              </span>
                              <span className="text-xs text-gray-800 font-medium">{f.description}</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleStartEditFraming(f)}
                              className="p-2 text-[#5A5A40] hover:bg-white rounded-lg transition-colors"
                              title="Editar Enquadramento"
                            >
                              <Edit3 size={15} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Deseja realmente excluir o enquadramento N° ${f.number}? Motivos de não-conformidade vinculados a ele perderão o vínculo.`)) {
                                  handleDeleteFraming(f.id);
                                }
                              }}
                              className="p-2 text-red-500 hover:bg-white rounded-lg transition-colors"
                              title="Excluir Enquadramento"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-400 italic bg-gray-50 p-4 rounded-xl border border-dashed border-gray-150 text-center">Nenhum enquadramento correspondente aos termos de busca.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

  {activeConfig === 'notification_types' && (
    <div className="mt-10 pt-10 border-t border-gray-200">
      <NotificationTemplatesManager
        notificationTypes={notificationTypes}
        setNotificationTypes={setNotificationTypes}
        isLocalMode={isLocalMode}
        handleFirestoreError={handleFirestoreError}
        batches={batches}
        pacs={pacs}
        setPacs={setPacs}
        nonConformityRecords={nonConformityRecords}
        nonConformitiesConfigs={nonConformitiesConfigs}
        logoUrl={logoUrl}
        signatures={signatures}
      />
    </div>
  )}
</div>
);
}

function StatsPanel({
  batches,
  collaborators,
  pacs,
  nonConformityRecords,
  nonConformitiesConfigs,
  generatedNotifications = [],
  notificationTypes = [],
  isLocalMode
}: {
  batches: any[];
  collaborators: any[];
  pacs: any[];
  nonConformityRecords?: any[];
  nonConformitiesConfigs?: any[];
  generatedNotifications?: any[];
  notificationTypes?: any[];
  isLocalMode?: boolean;
}) {
  // Default filter dates: last 30 days
  const defaultStatsStart = useMemo(() => format(addDays(new Date(), -30), 'yyyy-MM-dd'), []);
  const defaultStatsEnd = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const [selectedCollab, setSelectedCollab] = useState<string>('');
  const [filterPreset, setFilterPreset] = useState<'30days' | 'period' | 'year' | 'month'>('30days');
  const [statsStartDate, setStatsStartDate] = useState<string>(defaultStatsStart);
  const [statsEndDate, setStatsEndDate] = useState<string>(defaultStatsEnd);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth()); // 0-indexed

  // Synchronize start and end dates based on filter preset
  useEffect(() => {
    if (filterPreset === '30days') {
      setStatsStartDate(format(addDays(new Date(), -30), 'yyyy-MM-dd'));
      setStatsEndDate(format(new Date(), 'yyyy-MM-dd'));
    } else if (filterPreset === 'year') {
      setStatsStartDate(`${selectedYear}-01-01`);
      setStatsEndDate(`${selectedYear}-12-31`);
    } else if (filterPreset === 'month') {
      const firstDay = format(new Date(selectedYear, selectedMonth, 1), 'yyyy-MM-dd');
      const lastDay = format(new Date(selectedYear, selectedMonth + 1, 0), 'yyyy-MM-dd');
      setStatsStartDate(firstDay);
      setStatsEndDate(lastDay);
    }
  }, [filterPreset, selectedYear, selectedMonth]);

  // Compute unique list of collaborators with actual production in the filtered period
  // Evaluated based on the insertion date of each production field (recebidoEm, lidoEm, conferidoEm)
  const collabsWithProductionInPeriod = useMemo(() => {
    const list: string[] = [];
    const startDate = statsStartDate ? startOfDay(parseLocalDate(statsStartDate)) : null;
    const endDate = statsEndDate ? startOfDay(parseLocalDate(statsEndDate)) : null;

    batches.forEach(b => {
      // Recebido por
      if (b.recebidoPor && b.recebidoPor.trim() !== '') {
        const rDate = toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);
        if (rDate && (!startDate || rDate >= startDate) && (!endDate || startOfDay(rDate) <= endDate)) {
          list.push(b.recebidoPor.trim());
        }
      }

      // Lido por
      if (b.lidoPor && b.lidoPor.trim() !== '') {
        const lDate = toSafeDate(b.lidoEm) || toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);
        if (lDate && (!startDate || lDate >= startDate) && (!endDate || startOfDay(lDate) <= endDate)) {
          list.push(b.lidoPor.trim());
        }
      }

      // Informado por (conferidoPor)
      if (b.conferidoPor && b.conferidoPor.trim() !== '') {
        const cDate = toSafeDate(b.conferidoEm) || toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);
        if (cDate && (!startDate || cDate >= startDate) && (!endDate || startOfDay(cDate) <= endDate)) {
          list.push(b.conferidoPor.trim());
        }
      }
    });
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  }, [batches, statsStartDate, statsEndDate]);

  // Compute stats on batches using individual activity insertion dates
  // (recebidoPor uses recebidoEm, lidoPor uses lidoEm, conferidoPor uses conferidoEm)
  // Activity weights: Recebidos = 3% (0.03), Lidos = 27% (0.27), Informados = 70% (0.70)
  const WEIGHT_RECEBIDO = 0.03;
  const WEIGHT_LIDO = 0.27;
  const WEIGHT_INFORMADO = 0.70;

  const computedStats = useMemo(() => {
    const productivity: Record<string, {
      recebido: number;
      lotesRecebido: number;
      lido: number;
      lotesLido: number;
      informado: number;
      lotesInformado: number;
      total: number;
      totalLotes: number;
      weightedTotal: number;
      leadTimeSum: number;
      leadTimeCount: number;
    }> = {};
    
    let onTimeCount = 0;
    let lateCount = 0;
    let totalEnsaiosFinished = 0;
    let totalEnsaiosOpen = 0;

    // Executive KPI accumulators
    let totalEnsaiosReceivedPeriod = 0;
    let totalBatchesReceivedPeriod = 0;
    let totalEnsaiosLidoPeriod = 0;
    let totalBatchesLidoPeriod = 0;
    let totalBatchesFinishedPeriod = 0;

    // Team-wide weighted total (unfiltered by selectedCollab so single-collab filter still shows real team share %)
    let teamTotalWeightedPeriod = 0;

    let readLeadTimeDaysSum = 0;
    let readLeadTimeCount = 0;
    let closeLeadTimeDaysSum = 0;
    let closeLeadTimeCount = 0;
    let totalCycleDaysSum = 0;
    let totalCycleCount = 0;

    // Funnel counters
    let awaitingReadBatches = 0;
    let awaitingReadEnsaios = 0;
    let awaitingInformBatches = 0;
    let awaitingInformEnsaios = 0;

    const startDate = statsStartDate ? startOfDay(parseLocalDate(statsStartDate)) : null;
    const endDate = statsEndDate ? startOfDay(parseLocalDate(statsEndDate)) : null;

    // NC map by batch ID for Top NC Pareto
    const ncMapByBatch = new Map<string, any[]>();
    (nonConformityRecords || []).forEach((nc: any) => {
      if (nc.recebimento_lote_id) {
        const list = ncMapByBatch.get(nc.recebimento_lote_id) || [];
        list.push(nc);
        ncMapByBatch.set(nc.recebimento_lote_id, list);
      }
    });
    const ncReasonCounts: Record<string, { name: string; occurrences: number; platesCount: number }> = {};

    const ensureCollab = (name: string) => {
      if (!productivity[name]) {
        productivity[name] = {
          recebido: 0,
          lotesRecebido: 0,
          lido: 0,
          lotesLido: 0,
          informado: 0,
          lotesInformado: 0,
          total: 0,
          totalLotes: 0,
          weightedTotal: 0,
          leadTimeSum: 0,
          leadTimeCount: 0
        };
      }
    };

    batches.forEach(b => {
      const ensaios = Number(b.numEnsaios) || 0;
      const rDate = toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);
      const lDate = toSafeDate(b.lidoEm) || toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);
      const cDate = toSafeDate(b.conferidoEm) || toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);

      const hasRecebido = Boolean(b.recebidoPor && b.recebidoPor.trim() !== '');
      const hasLido = Boolean(b.lidoPor && b.lidoPor.trim() !== '');
      const hasInformado = Boolean(b.conferidoPor && b.conferidoPor.trim() !== '');

      const rInRange = Boolean(rDate && (!startDate || rDate >= startDate) && (!endDate || startOfDay(rDate) <= endDate));
      const lInRange = Boolean(lDate && (!startDate || lDate >= startDate) && (!endDate || startOfDay(lDate) <= endDate));
      const cInRange = Boolean(cDate && (!startDate || cDate >= startDate) && (!endDate || startOfDay(cDate) <= endDate));

      // 1. Recebido Por: date of insertion is b.recebidoEm (Weight: 3%)
      if (hasRecebido && rInRange) {
        const rName = b.recebidoPor.trim();
        teamTotalWeightedPeriod += ensaios * WEIGHT_RECEBIDO;
        if (!selectedCollab || rName === selectedCollab) {
          ensureCollab(rName);
          productivity[rName].recebido += ensaios;
          productivity[rName].lotesRecebido += 1;
          productivity[rName].total += ensaios;
          productivity[rName].totalLotes += 1;
          productivity[rName].weightedTotal += ensaios * WEIGHT_RECEBIDO;

          totalEnsaiosReceivedPeriod += ensaios;
          totalBatchesReceivedPeriod += 1;
        }
      }

      // 2. Lido Por: date of insertion is b.lidoEm (Weight: 27%)
      if (hasLido && lInRange) {
        const lName = b.lidoPor.trim();
        teamTotalWeightedPeriod += ensaios * WEIGHT_LIDO;
        if (!selectedCollab || lName === selectedCollab) {
          ensureCollab(lName);
          productivity[lName].lido += ensaios;
          productivity[lName].lotesLido += 1;
          productivity[lName].total += ensaios;
          productivity[lName].totalLotes += 1;
          productivity[lName].weightedTotal += ensaios * WEIGHT_LIDO;

          totalEnsaiosLidoPeriod += ensaios;
          totalBatchesLidoPeriod += 1;

          if (rDate && lDate) {
            const diffRead = Math.max(0, differenceInDays(startOfDay(lDate), startOfDay(rDate)));
            readLeadTimeDaysSum += diffRead;
            readLeadTimeCount += 1;
            productivity[lName].leadTimeSum += diffRead;
            productivity[lName].leadTimeCount += 1;
          }
        }
      }

      // 3. Informado Por: date of insertion is b.conferidoEm (Weight: 70%)
      if (hasInformado && cInRange) {
        const cName = b.conferidoPor.trim();
        teamTotalWeightedPeriod += ensaios * WEIGHT_INFORMADO;
        if (!selectedCollab || cName === selectedCollab) {
          ensureCollab(cName);
          productivity[cName].informado += ensaios;
          productivity[cName].lotesInformado += 1;
          productivity[cName].total += ensaios;
          productivity[cName].totalLotes += 1;
          productivity[cName].weightedTotal += ensaios * WEIGHT_INFORMADO;

          totalEnsaiosFinished += ensaios;
          totalBatchesFinishedPeriod += 1;

          if (lDate && cDate) {
            const diffClose = Math.max(0, differenceInDays(startOfDay(cDate), startOfDay(lDate)));
            closeLeadTimeDaysSum += diffClose;
            closeLeadTimeCount += 1;
          }
          if (rDate && cDate) {
            const diffTotal = Math.max(0, differenceInDays(startOfDay(cDate), startOfDay(rDate)));
            totalCycleDaysSum += diffTotal;
            totalCycleCount += 1;
            productivity[cName].leadTimeSum += diffTotal;
            productivity[cName].leadTimeCount += 1;
          }

          // Delivery Quality (tracked for batches informed/concluded in this period using 10d + 7d Correios = 17d rule)
          const pacDelivery = evaluatePacDeliveryDeadline(b.periodoInicial, b.recebidoEm, b.ensaioForaDoPrazo);
          if (pacDelivery.isLate) {
            lateCount++;
          } else {
            onTimeCount++;
          }
        }
      }

      // Bottleneck / Funnel tracking for open batches in period
      if (!hasInformado) {
        if (hasLido && lInRange) {
          if (!selectedCollab || b.lidoPor.trim() === selectedCollab) {
            awaitingInformBatches += 1;
            awaitingInformEnsaios += ensaios;
            totalEnsaiosOpen += ensaios;
          }
        } else if (!hasLido && rInRange) {
          if (!selectedCollab || (hasRecebido && b.recebidoPor.trim() === selectedCollab)) {
            awaitingReadBatches += 1;
            awaitingReadEnsaios += ensaios;
            totalEnsaiosOpen += ensaios;
          }
        }
      }

      // Non-conformity Pareto tracking for batches active in the selected period
      if (rInRange || lInRange || cInRange) {
        const matchesCollabAny = !selectedCollab ||
          (hasRecebido && b.recebidoPor.trim() === selectedCollab) ||
          (hasLido && b.lidoPor.trim() === selectedCollab) ||
          (hasInformado && b.conferidoPor.trim() === selectedCollab);

        if (matchesCollabAny) {
          const ncListLocal = b.nonConformities || [];
          const ncListFirestore = ncMapByBatch.get(b.id) || [];
          const batchNCs = ncListLocal.length > 0 ? ncListLocal : ncListFirestore;

          batchNCs.forEach((nc: any) => {
            const configObj = (nonConformitiesConfigs || []).find((c: any) => c.id === nc.nao_conformidade_id);
            const reasonName = configObj?.name || nc.nao_conformidade_name || nc.nao_conformidade_id || 'Outro Enquadramento';
            if (!ncReasonCounts[reasonName]) {
              ncReasonCounts[reasonName] = { name: reasonName, occurrences: 0, platesCount: 0 };
            }
            ncReasonCounts[reasonName].occurrences += 1;
            const platesLen = Array.isArray(nc.placas) ? nc.placas.length : 1;
            ncReasonCounts[reasonName].platesCount += platesLen;
          });
        }
      }
    });

    // Sort collaborators primarily by weighted productivity score (3% Recebidos + 27% Lidos + 70% Informados)
    const productivityList = Object.entries(productivity).sort((a, b) => {
      return b[1].weightedTotal - a[1].weightedTotal || b[1].total - a[1].total || a[0].localeCompare(b[0]);
    });

    const grandTotalProduced = productivityList.reduce((acc, [, d]) => acc + d.total, 0);
    const grandTotalWeighted = productivityList.reduce((acc, [, d]) => acc + d.weightedTotal, 0);

    const topNonConformities = Object.values(ncReasonCounts)
      .sort((a, b) => b.platesCount - a.platesCount || b.occurrences - a.occurrences)
      .slice(0, 4);

    const totalFinished = onTimeCount + lateCount;
    const throughputRate = totalEnsaiosReceivedPeriod > 0
      ? Math.round((totalEnsaiosFinished / totalEnsaiosReceivedPeriod) * 100)
      : (totalEnsaiosFinished > 0 ? 100 : 0);

    const avgReadDays = readLeadTimeCount > 0 ? (readLeadTimeDaysSum / readLeadTimeCount).toFixed(1) : '0.0';
    const avgCloseDays = closeLeadTimeCount > 0 ? (closeLeadTimeDaysSum / closeLeadTimeCount).toFixed(1) : '0.0';
    const avgTotalCycleDays = totalCycleCount > 0 ? (totalCycleDaysSum / totalCycleCount).toFixed(1) : '0.0';

    return {
      productivity: productivityList,
      grandTotalProduced,
      grandTotalWeighted,
      teamTotalWeightedPeriod,
      onTimeCount,
      lateCount,
      totalFinished,
      totalEnsaiosFinished,
      totalBatchesFinishedPeriod,
      totalEnsaiosOpen,
      totalEnsaiosReceivedPeriod,
      totalBatchesReceivedPeriod,
      totalEnsaiosLidoPeriod,
      totalBatchesLidoPeriod,
      throughputRate,
      avgReadDays,
      avgCloseDays,
      avgTotalCycleDays,
      awaitingReadBatches,
      awaitingReadEnsaios,
      awaitingInformBatches,
      awaitingInformEnsaios,
      topNonConformities
    };
  }, [batches, selectedCollab, statsStartDate, statsEndDate, nonConformityRecords, nonConformitiesConfigs]);

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Filtros da Tela Estatísticas */}
      <div className="bg-white p-6 rounded-[32px] border border-[#e5e5e0]">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#f5f5f0] pb-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#5A5A40]">Filtros de Estatística & KPIs</h3>
              <p className="text-xs text-[#5A5A40]/60">Selecione o período de análise de produtividade, SLA de tramitação e conformidade dos PACs.</p>
            </div>
            <div className="flex flex-wrap gap-1 bg-[#f5f5f0] p-1 rounded-xl">
              <button
                onClick={() => setFilterPreset('30days')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  filterPreset === '30days' ? "bg-white text-[#5A5A40] shadow-sm" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
                )}
              >
                Últimos 30 Dias
              </button>
              <button
                onClick={() => setFilterPreset('period')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  filterPreset === 'period' ? "bg-white text-[#5A5A40] shadow-sm" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
                )}
              >
                Por Período
              </button>
              <button
                onClick={() => setFilterPreset('year')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  filterPreset === 'year' ? "bg-white text-[#5A5A40] shadow-sm" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
                )}
              >
                Por Ano
              </button>
              <button
                onClick={() => setFilterPreset('month')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  filterPreset === 'month' ? "bg-white text-[#5A5A40] shadow-sm" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
                )}
              >
                Por Mês
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-end justify-between">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 w-full">
              {/* Filtro por Colaborador */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-[#5A5A40]">Filtrar por Colaborador</label>
                <select
                  className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                  value={selectedCollab}
                  onChange={(e) => setSelectedCollab(e.target.value)}
                >
                  <option value="">Todos os Colaboradores</option>
                  {collabsWithProductionInPeriod.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  {collabsWithProductionInPeriod.length === 0 && (
                    <option disabled value="">Nenhum colaborador com produção</option>
                  )}
                </select>
              </div>

              {/* Dynamic controls based on filterPreset */}
              {filterPreset === 'period' && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#5A5A40]">Período Inicial</label>
                    <input
                      type="date"
                      className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                      value={statsStartDate}
                      onChange={(e) => setStatsStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#5A5A40]">Período Final</label>
                    <input
                      type="date"
                      className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                      value={statsEndDate}
                      onChange={(e) => setStatsEndDate(e.target.value)}
                    />
                  </div>
                </>
              )}

              {filterPreset === '30days' && (
                <div className="col-span-2 space-y-2">
                  <label className="text-xs font-bold uppercase text-[#5A5A40]">Período Selecionado (Automático)</label>
                  <div className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm text-[#5A5A40]/80 font-medium">
                    De <span className="font-bold underline">{format(parseLocalDate(statsStartDate), 'dd/MM/yyyy')}</span> até <span className="font-bold underline">{format(parseLocalDate(statsEndDate), 'dd/MM/yyyy')}</span> (Últimos 30 dias)
                  </div>
                </div>
              )}

              {filterPreset === 'year' && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#5A5A40]">Selecionar Ano</label>
                    <select
                      className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                    >
                      {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#5A5A40]">Período do Ano</label>
                    <div className="w-full h-[48px] flex items-center px-4 bg-gray-50 border border-gray-100 rounded-xl text-xs text-[#5A5A40]/80 font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                      {format(parseLocalDate(statsStartDate), 'dd/MM/yyyy')} - {format(parseLocalDate(statsEndDate), 'dd/MM/yyyy')}
                    </div>
                  </div>
                </>
              )}

              {filterPreset === 'month' && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#5A5A40]">Selecionar Mês</label>
                    <select
                      className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    >
                      {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((m, idx) => (
                        <option key={idx} value={idx}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#5A5A40]">Selecionar Ano</label>
                    <select
                      className="w-full p-3 bg-[#f5f5f0] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                    >
                      {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Clear button if customized */}
            {(selectedCollab || filterPreset !== '30days' || selectedYear !== currentYear || selectedMonth !== new Date().getMonth()) && (
              <button
                onClick={() => {
                  setSelectedCollab('');
                  setFilterPreset('30days');
                  setSelectedYear(currentYear);
                  setSelectedMonth(new Date().getMonth());
                }}
                className="w-full lg:w-auto px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-all h-[44px] shrink-0 cursor-pointer"
              >
                Limpar Filtros
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 1. FAIXA EXECUTIVA DE KPIS DA OPERAÇÃO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Taxa de Vazão (Throughput) */}
        <div className="bg-white p-6 rounded-[28px] border border-[#e5e5e0] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A40]/70">Taxa de Vazão (Período)</span>
            <div className={cn(
              "p-2 rounded-xl",
              computedStats.throughputRate >= 90 ? "bg-emerald-50 text-emerald-700" : computedStats.throughputRate >= 70 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"
            )}>
              <TrendingUp size={18} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-display font-bold text-gray-900">{computedStats.throughputRate}%</span>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                computedStats.throughputRate >= 100 ? "bg-emerald-100 text-emerald-800" : computedStats.throughputRate >= 80 ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
              )}>
                {computedStats.throughputRate >= 100 ? 'Fila Reduzindo' : 'Em Fluxo'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              <strong className="text-gray-800">{computedStats.totalEnsaiosFinished.toLocaleString('pt-BR')}</strong> informados de <strong className="text-gray-800">{computedStats.totalEnsaiosReceivedPeriod.toLocaleString('pt-BR')}</strong> recebidos
            </p>
          </div>
        </div>

        {/* KPI 2: Tempo Médio até Leitura */}
        <div className="bg-white p-6 rounded-[28px] border border-[#e5e5e0] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A40]/70">SLA: Recebido → Lido</span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-700">
              <Clock size={18} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-display font-bold text-gray-900">{computedStats.avgReadDays}</span>
              <span className="text-xs font-bold text-gray-500">dias em média</span>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Tempo de espera até a leitura ({computedStats.totalBatchesLidoPeriod} {computedStats.totalBatchesLidoPeriod === 1 ? 'lote lido' : 'lotes lidos'})
            </p>
          </div>
        </div>

        {/* KPI 3: Tempo Médio de Fechamento */}
        <div className="bg-white p-6 rounded-[28px] border border-[#e5e5e0] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A40]/70">SLA: Lido → Informado</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-display font-bold text-gray-900">{computedStats.avgCloseDays}</span>
              <span className="text-xs font-bold text-gray-500">dias em média</span>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Ciclo total (Recebido → Informado): <strong className="text-emerald-800">{computedStats.avgTotalCycleDays} dias</strong>
            </p>
          </div>
        </div>

        {/* KPI 4: Gargalo Atual (Aguardando Fechamento) */}
        <div className="bg-white p-6 rounded-[28px] border border-[#e5e5e0] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A40]/70">Pendências de Fluxo</span>
            <div className={cn(
              "p-2 rounded-xl",
              computedStats.awaitingInformBatches > 0 ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"
            )}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-display font-bold text-gray-900">
                {(computedStats.awaitingReadBatches + computedStats.awaitingInformBatches)}
              </span>
              <span className="text-xs font-bold text-gray-500">lotes pendentes</span>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              <strong className="text-amber-700">{computedStats.awaitingReadBatches}</strong> s/ leitura • <strong className="text-blue-700">{computedStats.awaitingInformBatches}</strong> lidos s/ informar
            </p>
          </div>
        </div>
      </div>

      {/* 2. BLOCO CENTRAL: PRODUTIVIDADE POR COLABORADOR (2/3) + SAÚDE DO FLUXO & SLA (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Productivity by Collaborator x Activity */}
        <div className="lg:col-span-2 bg-white rounded-[32px] p-8 border border-[#e5e5e0] flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <BarChart3 className="text-[#5A5A40]" size={24} />
                <div>
                  <h3 className="text-xl font-display font-bold tracking-tight">Produtividade por Atividade</h3>
                  <p className="text-xs text-[#5A5A40]/70 mt-0.5">
                    Apuração ponderada por complexidade da etapa (Recebidos: 3%, Lidos: 27%, Informados: 70%) pelas datas de inserção.
                  </p>
                </div>
              </div>
              {selectedCollab && (
                <button
                  onClick={() => setSelectedCollab('')}
                  className="text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl self-start sm:self-auto flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Filtrado: <strong className="text-gray-900">{selectedCollab}</strong></span>
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Faixa de Pesos de Avaliação por Etapa */}
            <div className="mb-5 p-3 bg-[#f9f9f6] border border-[#e5e5e0] rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-[#5A5A40] uppercase tracking-wider text-[10px]">
                Pesos na Participação:
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200/80 text-amber-900 font-bold text-[11px]">
                  Recebidos: 3%
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200/80 text-blue-900 font-bold text-[11px]">
                  Lidos: 27%
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-900 font-bold text-[11px]">
                  Informados: 70%
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] uppercase font-bold text-[#5A5A40] opacity-70 border-b border-[#e5e5e0]">
                    <th className="pb-4">Colaborador</th>
                    <th className="pb-4 text-center">
                      Recebidos
                      <span className="block text-[9px] text-amber-700 font-extrabold">Peso 3%</span>
                    </th>
                    <th className="pb-4 text-center">
                      Lidos
                      <span className="block text-[9px] text-blue-700 font-extrabold">Peso 27%</span>
                    </th>
                    <th className="pb-4 text-center">
                      Informados
                      <span className="block text-[9px] text-emerald-700 font-extrabold">Peso 70%</span>
                    </th>
                    <th className="pb-4 text-center">
                      Score Ponderado
                      <span className="block text-[9px] text-[#5A5A40] font-normal lowercase">(bruto / lotes)</span>
                    </th>
                    <th className="pb-4 text-right">
                      Participação
                      <span className="block text-[9px] text-[#5A5A40] font-normal lowercase">(ponderada)</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f5f5f0]">
                  {computedStats.productivity.map(([name, data]: [string, any]) => {
                    const denominator = computedStats.teamTotalWeightedPeriod > 0
                      ? computedStats.teamTotalWeightedPeriod
                      : computedStats.grandTotalWeighted;
                    const rawShare = denominator > 0
                      ? (data.weightedTotal / denominator) * 100
                      : 0;
                    const shareFormatted = rawShare.toLocaleString('pt-BR', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1
                    });
                    const avgCollabDays = data.leadTimeCount > 0
                      ? (data.leadTimeSum / data.leadTimeCount).toFixed(1)
                      : null;

                    const ptsRecebido = (data.recebido || 0) * WEIGHT_RECEBIDO;
                    const ptsLido = (data.lido || 0) * WEIGHT_LIDO;
                    const ptsInformado = (data.informado || 0) * WEIGHT_INFORMADO;

                    return (
                      <tr
                        key={name}
                        onClick={() => setSelectedCollab(selectedCollab === name ? '' : name)}
                        title="Clique para filtrar este colaborador"
                        className={cn(
                          "group hover:bg-[#f5f5f0]/60 transition-colors cursor-pointer",
                          selectedCollab === name && "bg-[#f5f5f0]"
                        )}
                      >
                        <td className="py-4 pr-2">
                          <div className="font-bold text-gray-900 text-sm">{name}</div>
                          {avgCollabDays !== null && (
                            <span className="text-[10px] text-gray-400 font-medium block">
                              Média: {avgCollabDays}d por lote
                            </span>
                          )}
                        </td>
                        <td className="py-4 text-center">
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-lg text-xs font-bold inline-block">
                            {(data.recebido || 0).toLocaleString('pt-BR')}
                          </span>
                          <span className="block text-[10px] text-gray-400 mt-0.5 font-medium">
                            {data.lotesRecebido || 0} {data.lotesRecebido === 1 ? 'lote' : 'lotes'} • {ptsRecebido.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                          </span>
                        </td>
                        <td className="py-4 text-center">
                          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold inline-block">
                            {(data.lido || 0).toLocaleString('pt-BR')}
                          </span>
                          <span className="block text-[10px] text-gray-400 mt-0.5 font-medium">
                            {data.lotesLido || 0} {data.lotesLido === 1 ? 'lote' : 'lotes'} • {ptsLido.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                          </span>
                        </td>
                        <td className="py-4 text-center">
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold inline-block">
                            {(data.informado || 0).toLocaleString('pt-BR')}
                          </span>
                          <span className="block text-[10px] text-gray-400 mt-0.5 font-medium">
                            {data.lotesInformado || 0} {data.lotesInformado === 1 ? 'lote' : 'lotes'} • {ptsInformado.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                          </span>
                        </td>
                        <td className="py-4 text-center">
                          <span className="px-2.5 py-1 bg-[#5A5A40]/10 text-[#5A5A40] rounded-lg text-xs font-extrabold inline-block">
                            {data.weightedTotal.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                          </span>
                          <span className="block text-[10px] text-gray-400 mt-0.5 font-medium">
                            Bruto: {(data.total || 0).toLocaleString('pt-BR')} ({data.totalLotes || 0} ações)
                          </span>
                        </td>
                        <td className="py-4 pl-2 text-right min-w-[115px]">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs font-extrabold text-gray-800">{shareFormatted}%</span>
                          </div>
                          <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden mt-1">
                            <div
                              className="bg-[#5A5A40] h-full rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(100, rawShare)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {computedStats.productivity.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-[#5A5A40] opacity-60 italic">
                        Nenhuma atividade registrada para este período / filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
                {computedStats.productivity.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-[#e5e5e0] bg-[#fcfbf9] text-xs font-bold text-gray-900">
                      <td className="py-3.5 pl-2 uppercase text-[10px] tracking-wider text-[#5A5A40]">
                        Total da Equipe ({computedStats.productivity.length})
                      </td>
                      <td className="py-3.5 text-center text-amber-900">
                        {computedStats.totalEnsaiosReceivedPeriod.toLocaleString('pt-BR')}
                        <span className="block text-[9px] font-normal text-gray-500">
                          {computedStats.totalBatchesReceivedPeriod} lotes • {(computedStats.totalEnsaiosReceivedPeriod * WEIGHT_RECEBIDO).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                        </span>
                      </td>
                      <td className="py-3.5 text-center text-blue-900">
                        {computedStats.totalEnsaiosLidoPeriod.toLocaleString('pt-BR')}
                        <span className="block text-[9px] font-normal text-gray-500">
                          {computedStats.totalBatchesLidoPeriod} lotes • {(computedStats.totalEnsaiosLidoPeriod * WEIGHT_LIDO).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                        </span>
                      </td>
                      <td className="py-3.5 text-center text-emerald-900">
                        {computedStats.totalEnsaiosFinished.toLocaleString('pt-BR')}
                        <span className="block text-[9px] font-normal text-gray-500">
                          {computedStats.totalBatchesFinishedPeriod} lotes • {(computedStats.totalEnsaiosFinished * WEIGHT_INFORMADO).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                        </span>
                      </td>
                      <td className="py-3.5 text-center text-[#5A5A40]">
                        {computedStats.grandTotalWeighted.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts
                        <span className="block text-[9px] font-normal text-gray-500">
                          Bruto: {computedStats.grandTotalProduced.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="py-3.5 pr-2 text-right text-[#5A5A40]">100,0%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-gray-400">
            <span>💡 Dica: Clique no nome de um colaborador na tabela para filtrar seus indicadores.</span>
            <span>Fórmula: (Recebidos × 0,03) + (Lidos × 0,27) + (Informados × 0,70)</span>
          </div>
        </div>

        {/* Painel Substituto: Saúde do Fluxo, SLA & Top Não-Conformidades */}
        <div className="bg-white rounded-[32px] p-8 border border-[#e5e5e0] flex flex-col justify-between space-y-6">
          {/* Sub-bloco 1: Funil de Tramitação de Lotes */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <History className="text-[#5A5A40]" size={22} />
              <div>
                <h3 className="text-lg font-display font-bold tracking-tight text-gray-900">Saúde do Fluxo & SLA</h3>
                <p className="text-[11px] text-[#5A5A40]/70">Situação dos lotes movimentados no período</p>
              </div>
            </div>

            <div className="space-y-2.5">
              {/* Etapa 1: Aguardando Leitura */}
              <div className="p-3 rounded-2xl bg-amber-50/60 border border-amber-200/70 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <div>
                    <span className="text-xs font-bold text-amber-950 block">Aguardando Leitura</span>
                    <span className="text-[10px] text-amber-800/80">Recebidos, mas sem leitor</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-extrabold text-amber-900">{computedStats.awaitingReadBatches} lotes</span>
                  <span className="block text-[10px] text-amber-700 font-medium">{computedStats.awaitingReadEnsaios.toLocaleString('pt-BR')} ensaios</span>
                </div>
              </div>

              {/* Etapa 2: Aguardando Informação */}
              <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-200/70 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <div>
                    <span className="text-xs font-bold text-blue-950 block">Aguardando Informação</span>
                    <span className="text-[10px] text-blue-800/80">Lidos, pendentes de baixa</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-extrabold text-blue-900">{computedStats.awaitingInformBatches} lotes</span>
                  <span className="block text-[10px] text-blue-700 font-medium">{computedStats.awaitingInformEnsaios.toLocaleString('pt-BR')} ensaios</span>
                </div>
              </div>

              {/* Etapa 3: Finalizados (No Prazo vs Atrasados) */}
              <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <div>
                      <span className="text-xs font-bold text-emerald-950 block">Concluídos / Informados</span>
                      <span className="text-[10px] text-emerald-800/80">
                        {computedStats.totalFinished > 0 ? Math.round((computedStats.onTimeCount / computedStats.totalFinished) * 100) : 100}% entregues no prazo PAC (10d + 7d Correios = 17d)
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-extrabold text-emerald-900">{computedStats.totalFinished} lotes</span>
                    <span className="block text-[10px] text-emerald-700 font-medium">{computedStats.totalEnsaiosFinished.toLocaleString('pt-BR')} ensaios</span>
                  </div>
                </div>

                {/* Barra de proporção No Prazo vs Atrasado */}
                <div className="w-full h-2 bg-red-200 rounded-full overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{
                      width: `${computedStats.totalFinished > 0 ? (computedStats.onTimeCount / computedStats.totalFinished) * 100 : 100}%`
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-bold pt-0.5">
                  <span className="text-emerald-800">✓ No Prazo (≤17d): {computedStats.onTimeCount}</span>
                  <span className="text-red-700">⚠ Fora do Prazo (&gt;17d): {computedStats.lateCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sub-bloco 2: Top Motivos de Não-Conformidades no Período */}
          <div className="pt-5 border-t border-[#f5f5f0] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]">
                Principais Não-Conformidades
              </span>
              <span className="text-[10px] font-semibold text-gray-400">No período</span>
            </div>

            {computedStats.topNonConformities.length > 0 ? (
              <div className="space-y-2">
                {computedStats.topNonConformities.map((nc, idx) => (
                  <div key={nc.name} className="p-2.5 rounded-xl bg-[#f9f9f6] border border-[#e5e5e0] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-red-100 text-red-800 text-[10px] font-extrabold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-medium text-gray-800 truncate" title={nc.name}>
                        {nc.name}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-md">
                        {nc.platesCount} {nc.platesCount === 1 ? 'placa' : 'placas'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-gray-50 border border-dashed border-gray-200 text-center text-xs text-gray-400 italic">
                Nenhuma não-conformidade apontada nos lotes deste período.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. CENTRAL UNIFICADA DE DESEMPENHO, VOLUME E CONFORMIDADE POR PAC */}
      <PacUnifiedAnalyticsSection
        batches={batches}
        pacs={pacs}
        nonConformityRecords={nonConformityRecords}
        nonConformitiesConfigs={nonConformitiesConfigs}
        generatedNotifications={generatedNotifications}
        notificationTypes={notificationTypes}
        statsStartDate={statsStartDate}
        statsEndDate={statsEndDate}
        defaultStatsStart={defaultStatsStart}
        defaultStatsEnd={defaultStatsEnd}
      />
    </div>
  );
}

interface PacUnifiedAnalyticsSectionProps {
  batches: any[];
  pacs: any[];
  nonConformityRecords?: any[];
  nonConformitiesConfigs?: any[];
  generatedNotifications?: any[];
  notificationTypes?: any[];
  statsStartDate: string;
  statsEndDate: string;
  defaultStatsStart: string;
  defaultStatsEnd: string;
}

function PacUnifiedAnalyticsSection({
  batches,
  pacs,
  nonConformityRecords = [],
  nonConformitiesConfigs = [],
  generatedNotifications = [],
  notificationTypes = [],
  statsStartDate,
  statsEndDate,
  defaultStatsStart,
  defaultStatsEnd
}: PacUnifiedAnalyticsSectionProps) {
  const [viewMode, setViewMode] = useState<'ranking' | 'evolution'>('ranking');
  const [complianceTab, setComplianceTab] = useState<'all' | 'compliant' | 'nonCompliant' | 'highRisk' | 'inactive'>('all');
  const [pacSortOrder, setPacSortOrder] = useState<'score_asc' | 'score_desc' | 'ensaios_desc' | 'nc_desc' | 'leadtime_desc' | 'alphabetical'>('ensaios_desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedPacForModal, setSelectedPacForModal] = useState<any | null>(null);
  const [selectedPacEvolution, setSelectedPacEvolution] = useState<string>('all');

  // Compute complete KPIs per PAC in the selected period + historical regularity & regulatory risk
  const pacMetrics = useMemo(() => {
    const configPacNames = (pacs || []).map((p: any) => p.name || p.id).filter(Boolean);
    const batchPacNames = (batches || []).map((b: any) => b.pac).filter(Boolean);
    const allPacNames = Array.from(new Set([...configPacNames, ...batchPacNames])).sort((a, b) => a.localeCompare(b));

    const startDate = statsStartDate ? startOfDay(parseLocalDate(statsStartDate)) : null;
    const endDate = statsEndDate ? startOfDay(parseLocalDate(statsEndDate)) : null;
    const now = startOfDay(new Date());

    // Build NC Map by batch ID once
    const ncMapByBatch = new Map<string, any[]>();
    (nonConformityRecords || []).forEach((nc: any) => {
      if (nc.recebimento_lote_id) {
        const list = ncMapByBatch.get(nc.recebimento_lote_id) || [];
        list.push(nc);
        ncMapByBatch.set(nc.recebimento_lote_id, list);
      }
    });

    // Build set of already notified batch IDs
    const notifiedBatchIds = new Set<string>();
    (generatedNotifications || []).forEach((n: any) => {
      (n.batches || []).forEach((nb: any) => {
        if (nb?.id) notifiedBatchIds.add(nb.id);
      });
    });

    // Determine delay repetition threshold from configured notification rules (default 4)
    let delayLimitRepetitions = 4;
    let errorRateThreshold = 10;
    (notificationTypes || []).forEach((nt: any) => {
      if (nt?.rule?.active) {
        if (nt.rule.regraAtraso_ativa && typeof nt.rule.regraAtraso_limiteRepeticoes === 'number' && nt.rule.regraAtraso_limiteRepeticoes > 0) {
          delayLimitRepetitions = nt.rule.regraAtraso_limiteRepeticoes;
        }
        if (nt.rule.criterioA_ativo && typeof nt.rule.criterioA_limite === 'number' && nt.rule.criterioA_limite > 0) {
          errorRateThreshold = nt.rule.criterioA_limite;
        }
      }
    });

    // Filter batches belonging to the selected statistics period (by recebidoEm)
    const periodBatches = batches.filter(b => {
      const dateObj = toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);
      if (!dateObj) return false;
      if (startDate && dateObj < startDate) return false;
      if (endDate && startOfDay(dateObj) > endDate) return false;
      return true;
    });

    const results = allPacNames.map(pacName => {
      const pacBatches = periodBatches.filter(b => b.pac === pacName);
      const allHistoricalPacBatches = batches.filter(b => b.pac === pacName);
      const totalBatches = pacBatches.length;
      let totalEnsaiosDelivered = 0;
      let totalEnsaios = 0;

      let ncCount = 0;
      let ncPlatesCount = 0;
      let delayCount = 0;
      let baseOnTimeCount = 0; // <= 10 days
      let correiosToleranceCount = 0; // 11 to 17 days
      let cleanBatchesCount = 0; // 0 NCs and 0 delay

      let deliveryDaysSum = 0;
      let deliveryDaysCount = 0;

      const ncReasonMap: Record<string, { name: string; plates: number; occurrences: number }> = {};

      pacBatches.forEach(b => {
        const numEns = Number(b.numEnsaios) || 0;
        totalEnsaios += numEns;

        const isFinished = (b.conferidoPor && b.conferidoPor.trim() !== '') || b.status === 'FINALIZADO';
        if (isFinished) {
          totalEnsaiosDelivered += numEns;
        }

        const ncListLocal = b.nonConformities || [];
        const ncListFirestore = ncMapByBatch.get(b.id) || [];
        const batchNCs = ncListLocal.length > 0 ? ncListLocal : ncListFirestore;

        let hasBatchNc = false;
        if (batchNCs.length > 0) {
          hasBatchNc = true;
          ncCount += batchNCs.length;
          batchNCs.forEach((ncItem: any) => {
            const platesLen = Array.isArray(ncItem.placas) && ncItem.placas.length > 0 ? ncItem.placas.length : 1;
            ncPlatesCount += platesLen;
            const cfg = (nonConformitiesConfigs || []).find((c: any) => c.id === ncItem.nao_conformidade_id);
            const reasonName = cfg?.name || ncItem.nao_conformidade_name || ncItem.nao_conformidade_id || 'Outro Enquadramento';
            if (!ncReasonMap[reasonName]) {
              ncReasonMap[reasonName] = { name: reasonName, plates: 0, occurrences: 0 };
            }
            ncReasonMap[reasonName].plates += platesLen;
            ncReasonMap[reasonName].occurrences += 1;
          });
        }

        // Check PAC Delivery Deadline (Rule: 10d from periodoInicial + 7d Correios tolerance = 17 days to recebidoEm)
        const pacDelivery = evaluatePacDeliveryDeadline(b.periodoInicial, b.recebidoEm, b.ensaioForaDoPrazo);
        if (pacDelivery.elapsedDays !== null && pacDelivery.elapsedDays >= 0) {
          deliveryDaysSum += pacDelivery.elapsedDays;
          deliveryDaysCount += 1;
        }

        if (pacDelivery.isLate) {
          delayCount++;
        } else if (pacDelivery.isWithinCorreiosTolerance) {
          correiosToleranceCount++;
        } else {
          baseOnTimeCount++;
        }

        if (!hasBatchNc && !pacDelivery.isLate) {
          cleanBatchesCount++;
        }
      });

      const isFullyCompliant = ncCount === 0 && delayCount === 0;
      const errorRatePercent = totalEnsaios > 0 ? Number(((ncPlatesCount / totalEnsaios) * 100).toFixed(2)) : 0;
      const cleanBatchesRatePercent = totalBatches > 0 ? Math.round((cleanBatchesCount / totalBatches) * 100) : 100;
      const onTimeDeliveryRatePercent = totalBatches > 0 ? Math.round(((totalBatches - delayCount) / totalBatches) * 100) : 100;
      const avgDeliveryDays = deliveryDaysCount > 0 ? Number((deliveryDaysSum / deliveryDaysCount).toFixed(1)) : null;

      // Top #1 Non-conformity reason for this PAC in the period
      const sortedReasons = Object.values(ncReasonMap).sort((a, b) => b.plates - a.plates || b.occurrences - a.occurrences);
      const topNcReason = sortedReasons.length > 0 ? sortedReasons[0] : null;

      // KPI 4: Regulatory Risk / Notification Proximity (evaluated on unnotified batches + period metrics)
      const unnotifiedLateBatches = allHistoricalPacBatches.filter(b => {
        if (notifiedBatchIds.has(b.id)) return false;
        const evalRes = evaluatePacDeliveryDeadline(b.periodoInicial, b.recebidoEm, b.ensaioForaDoPrazo);
        return evalRes.isLate;
      });
      const unnotifiedLateCount = unnotifiedLateBatches.length;

      const pacNotifications = (generatedNotifications || []).filter(
        (n: any) => n.pac_name === pacName || n.pac_id === pacName
      );
      const notificationsCount = pacNotifications.length;
      const defensesCount = pacNotifications.filter((n: any) => n.status === 'DEFESA_APRESENTADA' || n.defenseText).length;

      // Risk level:
      // HIGH: unnotifiedLateCount >= delayLimitRepetitions OR errorRatePercent >= errorRateThreshold
      // MEDIUM: unnotifiedLateCount === delayLimitRepetitions - 1 OR (unnotifiedLateCount >= 2) OR errorRatePercent >= (errorRateThreshold * 0.6)
      // LOW: otherwise
      let regulatoryRiskLevel: 'ALTO' | 'MODERADO' | 'BAIXO' = 'BAIXO';
      let regulatoryRiskLabel = 'Regular';
      if (unnotifiedLateCount >= delayLimitRepetitions || errorRatePercent >= errorRateThreshold) {
        regulatoryRiskLevel = 'ALTO';
        regulatoryRiskLabel = unnotifiedLateCount >= delayLimitRepetitions
          ? `Gatilho Atraso (${unnotifiedLateCount}/${delayLimitRepetitions})`
          : `Erro ≥ ${errorRateThreshold}% (${errorRatePercent}%)`;
      } else if (unnotifiedLateCount >= Math.max(2, delayLimitRepetitions - 1) || errorRatePercent >= errorRateThreshold * 0.5 || delayCount > 0 || ncPlatesCount > 0) {
        regulatoryRiskLevel = 'MODERADO';
        regulatoryRiskLabel = unnotifiedLateCount > 0
          ? `${unnotifiedLateCount}/${delayLimitRepetitions} Atrasos Acum.`
          : `Monitoramento (${errorRatePercent}% erro)`;
      }

      // KPI 5: Regularity / Days since last shipment (considering only PACs with movement in the current year)
      let lastReceiptDate: Date | null = null;
      let hasCurrentYearActivity = false;
      const currentYear = now.getFullYear();
      allHistoricalPacBatches.forEach(b => {
        const d = toSafeDate(b.recebidoEm) || toSafeDate(b.periodoFinal) || toSafeDate(b.periodoInicial);
        if (d) {
          if (d.getFullYear() === currentYear) {
            hasCurrentYearActivity = true;
          }
          if (!lastReceiptDate || d.getTime() > lastReceiptDate.getTime()) {
            lastReceiptDate = d;
          }
        }
      });
      const daysSinceLastDelivery = lastReceiptDate
        ? Math.max(0, differenceInDays(now, startOfDay(lastReceiptDate)))
        : null;
      // Regra (Opção B): Considera apenas PACs que já tiveram movimentação no ano vigente e estão há mais de 30 dias sem enviar novo lote
      const isInactiveAlert = hasCurrentYearActivity && daysSinceLastDelivery !== null && daysSinceLastDelivery > 30;

      // KPI 1: PAC Quality Score (0 to 100) & Concept (A / B / C)
      // 60 points for Technical Quality (penalizes errorRatePercent) + 40 points for Punctuality (10d+7d=17d rule)
      const technicalScore = Math.max(0, 60 - (errorRatePercent * 6));
      const punctualityScore = (onTimeDeliveryRatePercent / 100) * 40;
      const qualityScore = totalBatches > 0 ? Math.round(Math.min(100, Math.max(0, technicalScore + punctualityScore))) : 100;
      const qualityConcept: 'A' | 'B' | 'C' =
        qualityScore >= 90 && regulatoryRiskLevel !== 'ALTO'
          ? 'A'
          : qualityScore >= 75 && regulatoryRiskLevel !== 'ALTO'
            ? 'B'
            : 'C';

      return {
        pac: pacName,
        totalBatches,
        totalEnsaios,
        totalEnsaiosDelivered,
        ncCount,
        ncPlatesCount,
        errorRatePercent,
        delayCount,
        baseOnTimeCount,
        correiosToleranceCount,
        cleanBatchesCount,
        cleanBatchesRatePercent,
        onTimeDeliveryRatePercent,
        avgDeliveryDays,
        topNcReason,
        sortedReasons,
        unnotifiedLateCount,
        delayLimitRepetitions,
        notificationsCount,
        defensesCount,
        regulatoryRiskLevel,
        regulatoryRiskLabel,
        lastReceiptDate,
        daysSinceLastDelivery,
        hasCurrentYearActivity,
        isInactiveAlert,
        qualityScore,
        qualityConcept,
        isFullyCompliant,
        pacBatches
      };
    });

    const activePacs = results.filter(r => r.totalBatches > 0);
    const compliantPacs = activePacs.filter(r => r.isFullyCompliant);
    const nonCompliantPacs = activePacs.filter(r => !r.isFullyCompliant);
    const highRiskPacs = activePacs.filter(r => r.regulatoryRiskLevel === 'ALTO' || r.qualityConcept === 'C');
    const inactivePacs = results.filter(r => r.isInactiveAlert);

    // Average score & average lead time across active PACs
    const avgQualityScore = activePacs.length > 0
      ? Math.round(activePacs.reduce((acc, p) => acc + p.qualityScore, 0) / activePacs.length)
      : 100;

    const pacsWithLeadTime = activePacs.filter(p => p.avgDeliveryDays !== null);
    const globalAvgDeliveryDays = pacsWithLeadTime.length > 0
      ? Number((pacsWithLeadTime.reduce((acc, p) => acc + (p.avgDeliveryDays || 0), 0) / pacsWithLeadTime.length).toFixed(1))
      : 0;

    const totalCorreiosToleranceBatches = activePacs.reduce((acc, p) => acc + p.correiosToleranceCount, 0);
    const totalLateBatches = activePacs.reduce((acc, p) => acc + p.delayCount, 0);

    return {
      allPacNames,
      allResults: results,
      periodBatches,
      activePacs,
      compliantPacs,
      nonCompliantPacs,
      highRiskPacs,
      inactivePacs,
      totalActivePacsCount: activePacs.length,
      compliantPacsCount: compliantPacs.length,
      nonCompliantPacsCount: nonCompliantPacs.length,
      highRiskPacsCount: highRiskPacs.length,
      inactivePacsCount: inactivePacs.length,
      compliancePercentage: activePacs.length > 0 ? Math.round((compliantPacs.length / activePacs.length) * 100) : 100,
      avgQualityScore,
      globalAvgDeliveryDays,
      totalCorreiosToleranceBatches,
      totalLateBatches,
      totalEnsaiosPeriod: activePacs.reduce((acc, p) => acc + p.totalEnsaios, 0),
      totalEnsaiosCompliant: compliantPacs.reduce((acc, p) => acc + p.totalEnsaios, 0)
    };
  }, [pacs, batches, nonConformityRecords, nonConformitiesConfigs, generatedNotifications, notificationTypes, statsStartDate, statsEndDate]);

  // Filter and sort list for the main table
  const displayedPacs = useMemo(() => {
    let list = [...pacMetrics.activePacs];
    if (complianceTab === 'compliant') {
      list = [...pacMetrics.compliantPacs];
    } else if (complianceTab === 'nonCompliant') {
      list = [...pacMetrics.nonCompliantPacs];
    } else if (complianceTab === 'highRisk') {
      list = [...pacMetrics.highRiskPacs];
    } else if (complianceTab === 'inactive') {
      list = [...pacMetrics.inactivePacs];
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      list = list.filter(item => item.pac.toLowerCase().includes(term));
    }

    if (pacSortOrder === 'ensaios_desc') {
      list.sort((a, b) => b.totalEnsaios - a.totalEnsaios || a.pac.localeCompare(b.pac));
    } else if (pacSortOrder === 'nc_desc') {
      list.sort((a, b) => b.ncPlatesCount - a.ncPlatesCount || b.delayCount - a.delayCount || b.totalEnsaios - a.totalEnsaios);
    } else if (pacSortOrder === 'score_asc') {
      list.sort((a, b) => a.qualityScore - b.qualityScore || b.ncPlatesCount - a.ncPlatesCount || b.delayCount - a.delayCount);
    } else if (pacSortOrder === 'score_desc') {
      list.sort((a, b) => b.qualityScore - a.qualityScore || b.totalEnsaios - a.totalEnsaios);
    } else if (pacSortOrder === 'leadtime_desc') {
      list.sort((a, b) => (b.avgDeliveryDays ?? -1) - (a.avgDeliveryDays ?? -1) || b.delayCount - a.delayCount);
    } else {
      list.sort((a, b) => a.pac.localeCompare(b.pac));
    }

    return list;
  }, [pacMetrics, complianceTab, searchTerm, pacSortOrder]);

  // Evolution grouping logic
  const rangeInDays = useMemo(() => {
    const start = parseLocalDate(statsStartDate || defaultStatsStart);
    const end = parseLocalDate(statsEndDate || defaultStatsEnd);
    return differenceInDays(end, start);
  }, [statsStartDate, statsEndDate, defaultStatsStart, defaultStatsEnd]);

  const groupingType = useMemo<'day' | 'month' | 'year'>(() => {
    if (rangeInDays <= 31) return 'day';
    if (rangeInDays <= 365) return 'month';
    return 'year';
  }, [rangeInDays]);

  const getGroupKeyAndLabel = (date: Date, type: 'day' | 'month' | 'year') => {
    if (type === 'day') {
      return { key: format(date, 'yyyy-MM-dd'), label: format(date, 'dd/MM/yyyy', { locale: ptBR }) };
    } else if (type === 'month') {
      return { key: format(date, 'yyyy-MM'), label: format(date, "MMM/yyyy", { locale: ptBR }) };
    }
    return { key: format(date, 'yyyy'), label: format(date, 'yyyy') };
  };

  const evolutionData = useMemo(() => {
    const groups: Record<string, { key: string; label: string; totalEnsaios: number; totalLotes: number; dateObj: Date }> = {};

    pacMetrics.periodBatches.forEach(b => {
      if (selectedPacEvolution !== 'all' && b.pac !== selectedPacEvolution) return;
      const date = toSafeDate(b.recebidoEm) || toSafeDate(b.periodoInicial);
      if (!date) return;
      const { key, label } = getGroupKeyAndLabel(date, groupingType);
      if (!groups[key]) {
        groups[key] = { key, label, totalEnsaios: 0, totalLotes: 0, dateObj: date };
      }
      groups[key].totalEnsaios += Number(b.numEnsaios) || 0;
      groups[key].totalLotes += 1;
    });

    return Object.values(groups).sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
  }, [pacMetrics.periodBatches, selectedPacEvolution, groupingType]);

  // Export excel handler
  const handleExportExcel = () => {
    const exportData = displayedPacs.map(item => ({
      'PAC': item.pac,
      'Score de Qualidade (0-100)': item.qualityScore,
      'Conceito': `Nível ${item.qualityConcept}`,
      'Lotes no Período': item.totalBatches,
      'Lotes 100% Limpos (%)': `${item.cleanBatchesRatePercent}%`,
      'Total de Ensaios': item.totalEnsaios,
      'Ensaios Concluídos': item.totalEnsaiosDelivered,
      'Lead Time Médio Envio (Dias)': item.avgDeliveryDays !== null ? item.avgDeliveryDays : 'N/A',
      'Entregas ≤ 10d (Prazo Base)': item.baseOnTimeCount,
      'Entregas 11-17d (Tolerância Correios)': item.correiosToleranceCount,
      'Atrasos > 17d (Fora do Prazo)': item.delayCount,
      'Ocorrências de NC': item.ncCount,
      'Placas com NC': item.ncPlatesCount,
      'Taxa de Erro (%)': `${item.errorRatePercent}%`,
      'Principal Não-Conformidade': item.topNcReason ? `${item.topNcReason.name} (${item.topNcReason.plates} pl.)` : 'Nenhuma',
      'Risco Regulatório': `${item.regulatoryRiskLevel} (${item.regulatoryRiskLabel})`,
      'Notificações Emitidas': item.notificationsCount,
      'Último Envio': item.lastReceiptDate ? format(item.lastReceiptDate, 'dd/MM/yyyy') : 'Sem registro',
      'Dias Sem Enviar': item.daysSinceLastDelivery !== null ? item.daysSinceLastDelivery : 'N/A',
      'Status de Conformidade': item.isFullyCompliant ? '100% CONFORME (SEM NC / SEM ATRASO >17D)' : 'COM OCORRÊNCIA'
    }));

    const ws = utils.json_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'KPIs_Desempenho_PACs');
    
    const startStr = statsStartDate || 'inicio';
    const endStr = statsEndDate || 'fim';
    writeFile(wb, `KPIs_Desempenho_e_Conformidade_PACs_${startStr}_ate_${endStr}.xlsx`);
  };

  // Copy list handler
  const handleCopyList = () => {
    const startStr = statsStartDate ? format(parseLocalDate(statsStartDate), 'dd/MM/yyyy') : 'Início';
    const endStr = statsEndDate ? format(parseLocalDate(statsEndDate), 'dd/MM/yyyy') : 'Fim';
    
    const lines = [
      `RELATÓRIO DE KPIS, DESEMPENHO E CONFORMIDADE DOS PACS`,
      `Período Analisado: ${startStr} até ${endStr}`,
      `Regra de Prazo do PAC: 10 dias (base) + 7 dias (Correios) = 17 dias da Data Inicial até o Recebimento`,
      `PACs 100% Conformes: ${pacMetrics.compliantPacsCount} de ${pacMetrics.totalActivePacsCount} (${pacMetrics.compliancePercentage}%)`,
      `Score Médio da Rede: ${pacMetrics.avgQualityScore}/100 pts | Lead Time Médio de Envio: ${pacMetrics.globalAvgDeliveryDays} dias`,
      `Volume Total de Ensaios no Período: ${pacMetrics.totalEnsaiosPeriod.toLocaleString('pt-BR')}`,
      `--------------------------------------------------`,
      ...displayedPacs.map((p, idx) => 
        `${idx + 1}. ${p.pac} [Conceito ${p.qualityConcept} - ${p.qualityScore}pts] -> ${p.totalEnsaios.toLocaleString('pt-BR')} ensaios (${p.totalBatches} lotes) | Lead Time: ${p.avgDeliveryDays ?? '-'}d | NCs: ${p.ncPlatesCount} pl. (${p.errorRatePercent}%) | Atrasos (>17d): ${p.delayCount} | Risco: ${p.regulatoryRiskLabel}`
      )
    ].join('\n');

    navigator.clipboard.writeText(lines);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="bg-white rounded-[32px] p-8 border border-[#e5e5e0] mt-8 space-y-6">
      {/* Header Unificado */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#f5f5f0] pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 rounded-2xl text-emerald-700">
            <ShieldCheck size={26} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-display font-bold tracking-tight text-gray-900">
                Central de KPIs, Qualidade e Conformidade por PAC
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-50 text-blue-800 border border-blue-200">
                Prazo Oficial: 10d + 7d Correios (17 dias)
              </span>
            </div>
            <p className="text-xs text-[#5A5A40]/70 mt-0.5">
              Score Geral (A/B/C), Lead Time de Envio (10d + 7d tolerância postal), Diagnóstico Técnico, Risco Regulatório e Regularidade.
            </p>
          </div>
        </div>

        {/* Mode Switcher + Export Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-[#f5f5f0] p-1 rounded-xl mr-2">
            <button
              onClick={() => setViewMode('ranking')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                viewMode === 'ranking' ? "bg-white text-[#5A5A40] shadow-xs" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
              )}
            >
              Matriz de KPIs & Ranking
            </button>
            <button
              onClick={() => setViewMode('evolution')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                viewMode === 'evolution' ? "bg-white text-[#5A5A40] shadow-xs" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
              )}
            >
              Gráfico de Evolução
            </button>
          </div>

          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <FileSpreadsheet size={15} />
            Exportar Excel
          </button>
          <button
            onClick={handleCopyList}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#f5f5f0] hover:bg-gray-200 text-[#5A5A40] rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <Copy size={15} />
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>

      {/* 5 KPI Summary Cards dos PACs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Score Médio & Conformidade */}
        <div className="bg-emerald-50/70 border border-emerald-200/80 p-4 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-800 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Score Médio da Rede</span>
            <ShieldCheck size={17} className="text-emerald-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-950">{pacMetrics.avgQualityScore}</span>
              <span className="text-xs font-bold text-emerald-700">/ 100 pts</span>
            </div>
            <p className="text-[11px] text-emerald-800/80 mt-1 font-medium">
              <strong>{pacMetrics.compliantPacsCount}</strong> de {pacMetrics.totalActivePacsCount} PACs 100% conformes ({pacMetrics.compliancePercentage}%)
            </p>
          </div>
        </div>

        {/* Card 2: Volume Total */}
        <div className="bg-[#f5f5f0]/70 border border-[#e5e5e0] p-4 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#5A5A40] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Volume Total dos PACs</span>
            <BarChart3 size={17} className="text-[#5A5A40]" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {pacMetrics.totalEnsaiosPeriod.toLocaleString('pt-BR')}
            </div>
            <p className="text-[11px] text-[#5A5A40]/70 mt-1 font-medium">
              <strong>{pacMetrics.totalEnsaiosCompliant.toLocaleString('pt-BR')}</strong> ensaios em PACs s/ ocorrências
            </p>
          </div>
        </div>

        {/* Card 3: Lead Time Médio de Envio (Regra 10d + 7d Correios = 17d) */}
        <div className="bg-blue-50/70 border border-blue-200/80 p-4 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-blue-800 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Lead Time Médio Envio</span>
            <Clock size={17} className="text-blue-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-blue-950">{pacMetrics.globalAvgDeliveryDays}</span>
              <span className="text-xs font-bold text-blue-700">dias (Limite: 17d)</span>
            </div>
            <p className="text-[11px] text-blue-800/80 mt-1 font-medium">
              <strong>{pacMetrics.totalCorreiosToleranceBatches}</strong> lotes na tolerância Correios (11–17d)
            </p>
          </div>
        </div>

        {/* Card 4: Termômetro de Risco Regulatório */}
        <div className="bg-amber-50/70 border border-amber-200/80 p-4 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-800 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Risco Regulatório / NC</span>
            <AlertTriangle size={17} className="text-amber-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-amber-950">{pacMetrics.nonCompliantPacsCount}</span>
              <span className="text-xs font-bold text-amber-800">c/ ocorrências</span>
            </div>
            <p className="text-[11px] text-amber-800/80 mt-1 font-medium">
              <strong>{pacMetrics.highRiskPacsCount}</strong> em alerta crítico • <strong>{pacMetrics.totalLateBatches}</strong> lotes &gt;17d
            </p>
          </div>
        </div>

        {/* Card 5: Regularidade de Envio / Inatividade */}
        <div className="bg-purple-50/60 border border-purple-200/80 p-4 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-purple-900 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Alerta de Inatividade</span>
            <History size={17} className="text-purple-600" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-purple-950">{pacMetrics.inactivePacsCount}</span>
              <span className="text-xs font-bold text-purple-700">PACs &gt;30d s/ envio</span>
            </div>
            <p className="text-[11px] text-purple-800/80 mt-1 font-medium">
              Apenas PACs com movimentação no ano vigente
            </p>
          </div>
        </div>
      </div>

      {viewMode === 'ranking' ? (
        <>
          {/* Filter Bar: Status Tabs + Sort + Search */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-2">
            <div className="flex flex-wrap gap-1 bg-[#f5f5f0] p-1 rounded-xl">
              <button
                onClick={() => setComplianceTab('all')}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  complianceTab === 'all' ? "bg-white text-[#5A5A40] shadow-xs" : "text-[#5A5A40]/70 hover:text-[#5A5A40]"
                )}
              >
                Todos no Período ({pacMetrics.totalActivePacsCount})
              </button>
              <button
                onClick={() => setComplianceTab('compliant')}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  complianceTab === 'compliant' ? "bg-white text-emerald-800 shadow-xs" : "text-[#5A5A40]/70 hover:text-[#5A5A40]"
                )}
              >
                <CheckCircle2 size={14} className={complianceTab === 'compliant' ? "text-emerald-600" : ""} />
                100% Conformes ({pacMetrics.compliantPacsCount})
              </button>
              <button
                onClick={() => setComplianceTab('nonCompliant')}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  complianceTab === 'nonCompliant' ? "bg-white text-amber-800 shadow-xs" : "text-[#5A5A40]/70 hover:text-[#5A5A40]"
                )}
              >
                <AlertTriangle size={14} className={complianceTab === 'nonCompliant' ? "text-amber-600" : ""} />
                Com Ocorrências ({pacMetrics.nonCompliantPacsCount})
              </button>
              <button
                onClick={() => setComplianceTab('highRisk')}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  complianceTab === 'highRisk' ? "bg-white text-red-800 shadow-xs" : "text-[#5A5A40]/70 hover:text-[#5A5A40]"
                )}
              >
                <AlertCircle size={14} className={complianceTab === 'highRisk' ? "text-red-600" : ""} />
                Risco Crítico / Nível C ({pacMetrics.highRiskPacsCount})
              </button>
              <button
                onClick={() => setComplianceTab('inactive')}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  complianceTab === 'inactive' ? "bg-white text-purple-900 shadow-xs" : "text-[#5A5A40]/70 hover:text-[#5A5A40]"
                )}
              >
                <Clock size={14} className={complianceTab === 'inactive' ? "text-purple-600" : ""} />
                Inativos &gt;30d ({pacMetrics.inactivePacsCount})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={pacSortOrder}
                onChange={(e) => setPacSortOrder(e.target.value as any)}
                className="px-3 py-2 bg-[#f5f5f0] border-none rounded-xl text-xs font-bold text-[#5A5A40] focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none"
              >
                <option value="ensaios_desc">Ordenar: Maior Volume de Ensaios</option>
                <option value="score_asc">Ordenar: Pior Score / Maior Criticidade</option>
                <option value="score_desc">Ordenar: Melhor Score de Qualidade (A→C)</option>
                <option value="nc_desc">Ordenar: Maior Nº de Falhas / NCs</option>
                <option value="leadtime_desc">Ordenar: Maior Tempo de Envio (Lead Time)</option>
                <option value="alphabetical">Ordenar: Ordem Alfabética (A-Z)</option>
              </select>

              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                <input
                  type="text"
                  placeholder="Buscar PAC..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#f5f5f0] border-none rounded-xl text-xs focus:ring-2 focus:ring-[#5A5A40]/20 focus:outline-none font-medium text-gray-700"
                />
              </div>
            </div>
          </div>

          {/* Unified PAC KPI Table */}
          <div className="overflow-x-auto rounded-2xl border border-[#e5e5e0]">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#f5f5f0] text-[10px] uppercase font-bold text-[#5A5A40] opacity-85 border-b border-[#e5e5e0]">
                  <th className="py-3.5 px-4">PAC & Regularidade</th>
                  <th className="py-3.5 px-3 text-center">Score & Conceito</th>
                  <th className="py-3.5 px-3 text-center">Volume & Lotes Limpos</th>
                  <th className="py-3.5 px-3 text-center">Lead Time Envio (10d+7d)</th>
                  <th className="py-3.5 px-3 text-center">Falhas & Diagnóstico</th>
                  <th className="py-3.5 px-3 text-center">Atrasos (&gt;17d)</th>
                  <th className="py-3.5 px-3 text-center">Risco Regulatório</th>
                  <th className="py-3.5 px-4 text-right">Raio-X</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5f5f0] bg-white">
                {displayedPacs.map((row, idx) => (
                  <tr key={row.pac} className="group hover:bg-[#f5f5f0]/40 transition-colors">
                    {/* Coluna 1: PAC + Regularidade de Envio */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-mono font-bold text-gray-400 w-5 mt-0.5">{idx + 1}º</span>
                        <div>
                          <span className="font-bold text-sm text-gray-900 block">{row.pac}</span>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {row.lastReceiptDate ? (
                              <span className={cn(
                                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                row.isInactiveAlert
                                  ? "bg-purple-100 text-purple-900 font-bold"
                                  : "text-gray-500 bg-gray-100"
                              )}>
                                Último envio: {format(row.lastReceiptDate, 'dd/MM/yyyy')} ({row.daysSinceLastDelivery}d atrás)
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-purple-800 bg-purple-50 px-1.5 py-0.5 rounded">
                                Sem histórico de envio
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Coluna 2: Score de Qualidade & Conceito A/B/C */}
                    <td className="py-3.5 px-3 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        <span className={cn(
                          "w-6 h-6 rounded-lg text-xs font-extrabold flex items-center justify-center border",
                          row.qualityConcept === 'A'
                            ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                            : row.qualityConcept === 'B'
                              ? "bg-amber-100 text-amber-900 border-amber-300"
                              : "bg-red-100 text-red-900 border-red-300"
                        )}>
                          {row.qualityConcept}
                        </span>
                        <div className="text-left">
                          <span className="text-xs font-extrabold text-gray-900 block leading-none">{row.qualityScore} pts</span>
                          <span className="text-[9px] text-gray-400 font-semibold">de 100</span>
                        </div>
                      </div>
                    </td>

                    {/* Coluna 3: Volume & Taxa de Lotes Limpos (First Pass Yield) */}
                    <td className="py-3.5 px-3 text-center">
                      <span className="font-extrabold text-xs text-gray-900 bg-gray-100 px-2.5 py-1 rounded-lg inline-block">
                        {row.totalEnsaios.toLocaleString('pt-BR')} ensaios
                      </span>
                      <span className="block text-[10px] text-gray-500 mt-1 font-medium">
                        {row.totalBatches} {row.totalBatches === 1 ? 'lote' : 'lotes'} • <strong className={row.cleanBatchesRatePercent === 100 ? "text-emerald-700" : "text-amber-700"}>{row.cleanBatchesRatePercent}% limpos</strong>
                      </span>
                    </td>

                    {/* Coluna 4: Lead Time Médio de Envio (10d + 7d Correios = 17d) */}
                    <td className="py-3.5 px-3 text-center">
                      {row.avgDeliveryDays !== null ? (
                        <div>
                          <span className={cn(
                            "px-2.5 py-0.5 rounded-full text-xs font-mono font-bold inline-block",
                            row.avgDeliveryDays <= PRAZO_BASE_PAC_DIAS
                              ? "bg-emerald-50 text-emerald-800"
                              : row.avgDeliveryDays <= PRAZO_MAXIMO_ENTREGA_PAC_DIAS
                                ? "bg-blue-50 text-blue-800"
                                : "bg-amber-100 text-amber-900"
                          )}>
                            {row.avgDeliveryDays} dias
                          </span>
                          <span className="block text-[10px] text-gray-400 mt-0.5">
                            {row.baseOnTimeCount} ≤10d • {row.correiosToleranceCount} Correios (11-17d)
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>

                    {/* Coluna 5: Não Conformidades & Principal Diagnóstico */}
                    <td className="py-3.5 px-3 text-center max-w-[200px]">
                      {row.ncCount === 0 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">
                          <Check size={12} /> 0 NCs (0%)
                        </span>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 rounded-full text-xs font-bold">
                            <AlertCircle size={11} /> {row.ncPlatesCount} pl. ({row.errorRatePercent}%)
                          </span>
                          {row.topNcReason && (
                            <span
                              className="block text-[10px] text-red-800/80 font-medium truncate mt-0.5"
                              title={`Principal falha: ${row.topNcReason.name} (${row.topNcReason.plates} placas)`}
                            >
                              1º: {row.topNcReason.name}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Coluna 6: Atrasos (> 17 dias) */}
                    <td className="py-3.5 px-3 text-center">
                      {row.delayCount === 0 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">
                          <Check size={12} /> 0 (&le;17d)
                        </span>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-full text-xs font-bold">
                            <Clock size={12} /> {row.delayCount} {row.delayCount === 1 ? 'lote' : 'lotes'} &gt;17d
                          </span>
                          <span className="block text-[10px] text-amber-800/80 mt-0.5 font-medium">
                            Pontualidade: {row.onTimeDeliveryRatePercent}%
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Coluna 7: Termômetro de Risco Regulatório */}
                    <td className="py-3.5 px-3 text-center">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold",
                        row.regulatoryRiskLevel === 'ALTO'
                          ? "bg-red-100 text-red-900 border border-red-200"
                          : row.regulatoryRiskLevel === 'MODERADO'
                            ? "bg-amber-100 text-amber-900 border border-amber-200"
                            : "bg-emerald-100 text-emerald-800"
                      )}>
                        {row.regulatoryRiskLevel === 'ALTO' ? (
                          <AlertCircle size={12} className="text-red-600 shrink-0" />
                        ) : row.regulatoryRiskLevel === 'MODERADO' ? (
                          <AlertTriangle size={12} className="text-amber-700 shrink-0" />
                        ) : (
                          <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                        )}
                        <span>{row.regulatoryRiskLabel}</span>
                      </span>
                      {row.notificationsCount > 0 && (
                        <span className="block text-[10px] text-gray-500 mt-0.5 font-semibold">
                          {row.notificationsCount} {row.notificationsCount === 1 ? 'notificação' : 'notificações'}
                        </span>
                      )}
                    </td>

                    {/* Coluna 8: Ação Raio-X / Ver Lotes */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedPacForModal(row)}
                        className="px-3 py-1.5 bg-[#f5f5f0] hover:bg-[#5A5A40] hover:text-white text-[#5A5A40] rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                      >
                        Raio-X / Lotes
                      </button>
                    </td>
                  </tr>
                ))}

                {displayedPacs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-[#5A5A40]/70 italic">
                      Nenhum PAC encontrado para os filtros selecionados neste período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* ABA DE EVOLUÇÃO TEMPORAL POR PAC */
        <div className="space-y-6 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#f9f9f6] p-4 rounded-2xl border border-[#e5e5e0]">
            <div>
              <h4 className="text-sm font-bold text-gray-900">Evolução Cronológica de Volume</h4>
              <p className="text-xs text-gray-500">
                Acompanhe o comportamento de entrega de ensaios ao longo do tempo ({groupingType === 'day' ? 'Diário' : groupingType === 'month' ? 'Mensal' : 'Anual'}).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase text-[#5A5A40]">Selecionar PAC:</label>
              <select
                value={selectedPacEvolution}
                onChange={(e) => setSelectedPacEvolution(e.target.value)}
                className="px-3 py-2 bg-white border border-[#e5e5e0] rounded-xl text-xs font-bold text-[#5A5A40] focus:outline-none"
              >
                <option value="all">Todos os PACs Consolidados</option>
                {pacMetrics.allPacNames.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 bg-[#fcfbf9] p-6 rounded-2xl border border-[#e5e5e0]">
              {evolutionData.length > 1 ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={evolutionData} margin={{ top: 15, right: 25, left: 5, bottom: 10 }}>
                      <defs>
                        <linearGradient id="colorEnsaiosUnified" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E5E0" />
                      <XAxis dataKey="label" tick={{ fill: '#5A5A40', fontSize: 10 }} axisLine={{ stroke: '#E5E5E0' }} />
                      <YAxis tick={{ fill: '#5A5A40', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'white', borderRadius: '14px', border: '1px solid #E5E5E0', fontSize: '12px' }}
                        labelStyle={{ fontWeight: 'bold', color: '#1a1a1a' }}
                      />
                      <Area type="monotone" dataKey="totalEnsaios" name="Total de Ensaios" stroke="#10b981" fillOpacity={1} fill="url(#colorEnsaiosUnified)" strokeWidth={3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 h-64 text-xs text-[#5A5A40]/60 text-center">
                  <Clock size={32} className="text-[#5A5A40]/30 mb-2" />
                  <span>Selecione um intervalo com entregas em ao menos 2 datas/meses distintos para visualizar a curva de evolução.</span>
                </div>
              )}
            </div>

            <div className="overflow-y-auto max-h-80 rounded-2xl border border-[#e5e5e0]">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#f5f5f0] text-[10px] uppercase font-bold text-[#5A5A40] border-b border-[#e5e5e0]">
                    <th className="py-3 px-4">Período</th>
                    <th className="py-3 px-4 text-center">Lotes</th>
                    <th className="py-3 px-4 text-right">Ensaios</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f5f5f0] bg-white">
                  {evolutionData.map(item => (
                    <tr key={item.key} className="hover:bg-gray-50">
                      <td className="py-2.5 px-4 text-xs font-medium capitalize">{item.label}</td>
                      <td className="py-2.5 px-4 text-center text-xs text-gray-500">{item.totalLotes}</td>
                      <td className="py-2.5 px-4 text-right text-xs font-bold text-emerald-700">
                        {item.totalEnsaios.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                  {evolutionData.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-xs text-gray-400 italic">Sem registros no período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Raio-X do PAC & Lotes no Período */}
      {selectedPacForModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 space-y-5 shadow-xl border border-[#e5e5e0] max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase text-[#5A5A40] opacity-60">Raio-X de KPIs & Lotes do PAC</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] font-extrabold",
                    selectedPacForModal.qualityConcept === 'A'
                      ? "bg-emerald-100 text-emerald-900"
                      : selectedPacForModal.qualityConcept === 'B'
                        ? "bg-amber-100 text-amber-900"
                        : "bg-red-100 text-red-900"
                  )}>
                    Conceito {selectedPacForModal.qualityConcept} ({selectedPacForModal.qualityScore}/100 pts)
                  </span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mt-0.5">{selectedPacForModal.pac}</h3>
              </div>
              <button
                onClick={() => setSelectedPacForModal(null)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-500 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Resumo Executivo dos 5 KPIs do PAC no Modal */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-2xl bg-[#f9f9f6] border border-[#e5e5e0]">
                <span className="text-[10px] font-bold uppercase text-[#5A5A40]/70 block">Qualidade & Lotes Limpos</span>
                <span className="text-base font-extrabold text-gray-900">{selectedPacForModal.cleanBatchesRatePercent}% limpos</span>
                <span className="block text-[10px] text-gray-500 mt-0.5">
                  {selectedPacForModal.cleanBatchesCount} de {selectedPacForModal.totalBatches} lotes sem falhas/atraso
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-blue-50/50 border border-blue-200/70">
                <span className="text-[10px] font-bold uppercase text-blue-800 block">Lead Time (Limite 17d)</span>
                <span className="text-base font-extrabold text-blue-950">
                  {selectedPacForModal.avgDeliveryDays !== null ? `${selectedPacForModal.avgDeliveryDays} dias` : 'N/A'}
                </span>
                <span className="block text-[10px] text-blue-800/80 mt-0.5">
                  {selectedPacForModal.baseOnTimeCount} ≤10d • {selectedPacForModal.correiosToleranceCount} Correios (11-17d) • {selectedPacForModal.delayCount} &gt;17d
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50/50 border border-amber-200/70">
                <span className="text-[10px] font-bold uppercase text-amber-900 block">Risco Regulatório</span>
                <span className="text-sm font-extrabold text-amber-950 block">{selectedPacForModal.regulatoryRiskLabel}</span>
                <span className="block text-[10px] text-amber-800/80 mt-0.5">
                  {selectedPacForModal.notificationsCount} notificações • {selectedPacForModal.defensesCount} defesas
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-purple-50/50 border border-purple-200/70">
                <span className="text-[10px] font-bold uppercase text-purple-900 block">Regularidade de Envio</span>
                <span className="text-sm font-extrabold text-purple-950 block">
                  {selectedPacForModal.lastReceiptDate ? format(selectedPacForModal.lastReceiptDate, 'dd/MM/yyyy') : 'Sem envio'}
                </span>
                <span className="block text-[10px] text-purple-800/80 mt-0.5">
                  {selectedPacForModal.daysSinceLastDelivery !== null ? `${selectedPacForModal.daysSinceLastDelivery} dias desde a última remessa` : 'Nenhum lote registrado'}
                </span>
              </div>
            </div>

            {/* Diagnóstico Técnico de Não-Conformidades do PAC */}
            {selectedPacForModal.sortedReasons && selectedPacForModal.sortedReasons.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-red-50/60 border border-red-200/80 space-y-2">
                <span className="text-[10px] font-bold uppercase text-red-900 block">
                  Diagnóstico Técnico — Principais Motivos de Não-Conformidade do PAC no Período
                </span>
                <div className="flex flex-wrap gap-2">
                  {selectedPacForModal.sortedReasons.map((r: any, idx: number) => (
                    <span key={r.name} className="px-2.5 py-1 rounded-lg bg-white border border-red-200 text-xs font-bold text-red-800">
                      {idx + 1}º {r.name}: {r.plates} {r.plates === 1 ? 'placa' : 'placas'} ({r.occurrences} {r.occurrences === 1 ? 'lote' : 'lotes'})
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]">
                Relação de Lotes no Período ({selectedPacForModal.pacBatches.length})
              </h4>
              {selectedPacForModal.pacBatches.map((b: any) => {
                const batchNCs = (b.nonConformities && Array.isArray(b.nonConformities) && b.nonConformities.length > 0)
                  ? b.nonConformities
                  : (nonConformityRecords || []).filter((nc: any) => nc.recebimento_lote_id === b.id);
                const pacEval = evaluatePacDeliveryDeadline(b.periodoInicial, b.recebidoEm, b.ensaioForaDoPrazo);

                return (
                  <div key={b.id} className="p-4 bg-[#f5f5f0]/60 rounded-2xl border border-[#e5e5e0] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-800">
                          Período: {pacEval.pInicialDate ? format(pacEval.pInicialDate, 'dd/MM/yyyy') : '-'} a {toSafeDate(b.periodoFinal) ? format(toSafeDate(b.periodoFinal)!, 'dd/MM/yyyy') : '-'}
                        </span>
                        {pacEval.elapsedDays !== null && (
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-md",
                            pacEval.isLate
                              ? "bg-amber-100 text-amber-900 border border-amber-300"
                              : pacEval.isWithinCorreiosTolerance
                                ? "bg-blue-100 text-blue-800"
                                : "bg-emerald-100 text-emerald-800"
                          )}>
                            Envio em {pacEval.elapsedDays}d {pacEval.isLate ? `(Fora do prazo >17d)` : pacEval.isWithinCorreiosTolerance ? `(Tolerância Correios 10d+7d)` : `(No prazo ≤10d)`}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md">
                        {b.numEnsaios} ensaios
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600">
                      <div>
                        <span className="font-semibold block text-[10px] uppercase opacity-60">Recebido Por / Em:</span>
                        {b.recebidoPor || '-'} ({toSafeDate(b.recebidoEm) ? format(toSafeDate(b.recebidoEm)!, 'dd/MM/yyyy') : '-'})
                      </div>
                      <div>
                        <span className="font-semibold block text-[10px] uppercase opacity-60">Lido Por / Em:</span>
                        {b.lidoPor || 'Pendente'} {toSafeDate(b.lidoEm) ? `(${format(toSafeDate(b.lidoEm)!, 'dd/MM/yyyy')})` : ''}
                      </div>
                      <div>
                        <span className="font-semibold block text-[10px] uppercase opacity-60">Informado Por / Em:</span>
                        {b.conferidoPor || 'Pendente'} {toSafeDate(b.conferidoEm) ? `(${format(toSafeDate(b.conferidoEm)!, 'dd/MM/yyyy')})` : ''}
                      </div>
                    </div>

                    {batchNCs.length > 0 ? (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-red-800 block">
                          Não Conformidades ({batchNCs.length}):
                        </span>
                        <ul className="text-xs text-red-900 space-y-1 list-disc list-inside">
                          {batchNCs.map((ncItem: any, idx: number) => (
                            <li key={ncItem.id || idx}>
                              {ncItem.nao_conformidade_name || ncItem.nao_conformidade_id || 'Não Conformidade'}
                              {ncItem.placas && Array.isArray(ncItem.placas) && ncItem.placas.length > 0 && (
                                <span className="font-mono text-[11px] text-red-700 ml-1">
                                  [Placa(s): {ncItem.placas.join(', ')}]
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50/80 px-2.5 py-1 rounded-lg font-medium inline-block">
                        ✓ Nenhuma não conformidade neste lote
                      </div>
                    )}

                    {pacEval.isLate && (
                      <div className="text-xs text-amber-800 bg-amber-100 p-2 rounded-lg font-bold flex items-center gap-1.5">
                        <AlertTriangle size={14} className="text-amber-600" />
                        Entrega fora do prazo regulamentar (Regra 10d + 7d Correios = 17 dias da data inicial{pacEval.maxDeadlineDate ? ` • Limite era ${format(pacEval.maxDeadlineDate, 'dd/MM/yyyy')}` : ''}).
                      </div>
                    )}
                  </div>
                );
              })}
              {selectedPacForModal.pacBatches.length === 0 && (
                <div className="p-6 text-center text-xs text-gray-400 italic bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  Nenhum lote recebido para este PAC no período selecionado.
                </div>
              )}
            </div>

            <div className="pt-2 text-right">
              <button
                onClick={() => setSelectedPacForModal(null)}
                className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
