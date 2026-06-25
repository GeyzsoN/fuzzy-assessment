'use client';

import React, { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { 
  RefreshCw, 
  Plus, 
  Trash2, 
  Users, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ListOrdered, 
  ChevronRight, 
  Sparkles, 
  X, 
  ArrowRight, 
  ArrowLeft,
  Mail,
  Volume2,
  FileText,
  UserPlus,
  Search,
} from 'lucide-react';
import Shell from '@/components/shell';
import { campaignsService, groupsService, contactsService, Group, Contact, Campaign, CampaignTemplate } from '@/services/api';

interface BuilderStep {
  order: number;
  delayMinutes: number;
  subjectTemplate: string;
  promptTemplate: string;
}

// Structured outreach goals with default templates and tones
const OUTREACH_TEMPLATES = {
  sales: {
    id: 'sales' as const,
    name: 'Sales Outreach Pitch',
    description: 'Pitch your core product value, automate follow-ups, and book client demos.',
    subject: 'Optimizing your workflow efficiency',
    tone: 'Warm',
    generationPrompt: 'Generate a concise multi-step sales outreach sequence that introduces our product value, follows up with a practical workflow benefit, and closes politely if there is no interest. Each step should be an actual email body with placeholders like {{first_name}}, {{title}}, and {{company}}.',
    prompt: 'Hi {{first_name}},\n\nI noticed your work as {{title}} at {{company}} and thought there may be a practical way to automate repeatable operational sequences for your team.\n\nWorth a quick look?',
    coverImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&h=400&q=80',
  },
  recruiting: {
    id: 'recruiting' as const,
    name: 'Talent Acquisition Outreach',
    description: 'Reach high-performing candidates and pitch open roles at your organization.',
    subject: 'Exploring career opportunities together',
    tone: 'Professional',
    generationPrompt: 'Generate a concise multi-step recruiting outreach sequence that introduces a relevant role, follows up with why the opportunity may fit the recipient, and closes politely. Each step should be an actual email body with placeholders like {{first_name}}, {{title}}, and {{company}}.',
    prompt: 'Hi {{first_name}},\n\nYour work as {{title}} stood out. I am reaching out because there may be a role that matches the kind of impact you have had at {{company}}.\n\nOpen to a brief conversation?',
    coverImage: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=600&h=400&q=80',
  },
  partnership: {
    id: 'partnership' as const,
    name: 'Strategic Partnership Proposal',
    description: 'Reach out to executive leaders to propose business integrations or deals.',
    subject: 'Exploring strategic integration with ${contactCompany}',
    tone: 'Direct',
    generationPrompt: 'Generate a concise multi-step partnership outreach sequence that opens with a practical collaboration angle, follows up with a specific integration or partnership reason, and closes politely. Each step should be an actual email body with placeholders like {{first_name}}, {{title}}, and {{company}}.',
    prompt: 'Hi {{first_name}},\n\nI think there may be a practical integration angle between our workflows and what {{company}} is building. If relevant, I would be glad to compare notes for 15 minutes next week.\n\nWorth exploring?',
    coverImage: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&h=400&q=80',
  },
};

const CORE_PROMPT_TEMPLATES = [
  {
    label: '2-step opener',
    value: 'Create a 2-step LinkedIn outreach sequence for {{name}}, a {{title}} at {{company}}. Step 1 should be a concise opener. Step 2 should be a polite follow-up. Keep each email body under 60 words.',
  },
  {
    label: '3-step warm intro',
    value: 'Create a 3-step warm outreach sequence for {{name}}, a {{title}} at {{company}}. Step 1 should mention their role, step 2 should expand on a practical workflow benefit, and step 3 should close politely. Keep each email body under 70 words.',
  },
  {
    label: '4-step direct sales',
    value: 'Create a 4-step direct sales outreach sequence for {{name}}, a {{title}} at {{company}}. Step 1 should identify a practical pain point, step 2 should explain the business value, step 3 should offer a concrete example, and step 4 should close the loop politely. Keep each email body under 70 words.',
  },
];

const DEFAULT_CORE_PROMPT_TEMPLATE = CORE_PROMPT_TEMPLATES[0].value;

function getDelayFields(minutes: number): { amount: number; unit: 'minutes' | 'hours' | 'days' } {
  if (minutes % 1440 === 0 && minutes >= 1440) {
    return { amount: minutes / 1440, unit: 'days' };
  }
  if (minutes % 60 === 0 && minutes >= 60) {
    return { amount: minutes / 60, unit: 'hours' };
  }
  return { amount: minutes, unit: 'minutes' };
}

function getMinutesFromFields(amount: number, unit: 'minutes' | 'hours' | 'days'): number {
  if (unit === 'days') return amount * 1440;
  if (unit === 'hours') return amount * 60;
  return amount;
}

const CAMPAIGN_LIMITS = [5, 10, 20];
const CAMPAIGN_STATUS_FILTERS = [
  'all',
  'draft',
  'generating',
  'launching',
  'running',
  'completed',
  'failed',
] as const;
const SHOW_LEGACY_CAMPAIGN_FORMS = false;
type CampaignStatusFilter = (typeof CAMPAIGN_STATUS_FILTERS)[number];

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readCampaignLimit(value: string | null) {
  const parsed = readPositiveInt(value, 10);
  return CAMPAIGN_LIMITS.includes(parsed) ? parsed : 10;
}

function readStatusFilter(value: string | null): CampaignStatusFilter {
  return CAMPAIGN_STATUS_FILTERS.includes(value as CampaignStatusFilter)
    ? (value as CampaignStatusFilter)
    : 'all';
}

function readWizardStep(value: string | null) {
  return Math.min(5, Math.max(1, readPositiveInt(value, 1)));
}

function matchesSearch(query: string, values: Array<string | number | undefined | null>) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return values.some((value) =>
    String(value ?? '').toLowerCase().includes(normalized),
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<Shell><div className="text-sm text-slate-500">Loading campaigns...</div></Shell>}>
      <CampaignsPageContent />
    </Suspense>
  );
}

function CampaignsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const urlPage = readPositiveInt(searchParams.get('page'), 1);
  const urlLimit = readCampaignLimit(searchParams.get('limit'));
  const statusFilter = readStatusFilter(searchParams.get('status'));
  const wizardOpenFromUrl = searchParams.get('wizard') === '1';
  const wizardStepFromUrl = readWizardStep(searchParams.get('step'));

  // Data states
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaignTemplates, setCampaignTemplates] = useState<CampaignTemplate[]>([]);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // General Manual Campaign Builder State (maintained for backward compatibility)
  const [campaignName, setCampaignName] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [sequenceSteps, setSequenceSteps] = useState<BuilderStep[]>([
    {
      order: 1,
      delayMinutes: 5,
      subjectTemplate: 'Improving your workflow efficiency',
      promptTemplate: 'Hi {{first_name}},\n\nI noticed your work as {{title}} at {{company}} and thought there may be a practical way to automate repeatable operational sequences for your team.\n\nWorth a quick look?',
    }
  ]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Primary campaign creation form.
  const [coreName, setCoreName] = useState('');
  const [corePromptTemplate, setCorePromptTemplate] = useState(
    DEFAULT_CORE_PROMPT_TEMPLATE,
  );
  const [coreGroupIds, setCoreGroupIds] = useState<string[]>([]);
  const [coreContactIds, setCoreContactIds] = useState<string[]>([]);
  const [coreGroupSearch, setCoreGroupSearch] = useState('');
  const [coreContactSearch, setCoreContactSearch] = useState('');
  const [coreCreating, setCoreCreating] = useState(false);
  const [coreError, setCoreError] = useState<string | null>(null);

  // Recipient Preview State
  const [eligibleRecipients, setEligibleRecipients] = useState<Array<{ id: string; name: string; email: string; source: string }>>([]);

  // Campaign Wizard States
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardOutreachType, setWizardOutreachType] = useState<keyof typeof OUTREACH_TEMPLATES>('sales');
  const [wizardName, setWizardName] = useState('');
  const [wizardTone, setWizardTone] = useState('Warm');
  const [wizardSelectedGroupIds, setWizardSelectedGroupIds] = useState<string[]>([]);
  const [wizardSelectedContactIds, setWizardSelectedContactIds] = useState<string[]>([]);
  const [wizardGroupSearch, setWizardGroupSearch] = useState('');
  const [wizardContactSearch, setWizardContactSearch] = useState('');
  const [wizardRawImportText, setWizardRawImportText] = useState('');
  
  // Build Mode Choice
  const [wizardMode, setWizardMode] = useState<'auto' | 'manual'>('auto');
  const [wizardSinglePrompt, setWizardSinglePrompt] = useState('');
  const [wizardDelayAmount, setWizardDelayAmount] = useState<number>(3);
  const [wizardDelayUnit, setWizardDelayUnit] = useState<'minutes' | 'hours' | 'days'>('days');

  const [wizardStepsCount, setWizardStepsCount] = useState<number>(1);
  const [wizardSteps, setWizardSteps] = useState<BuilderStep[]>([
    {
      order: 1,
      delayMinutes: 5,
      subjectTemplate: 'Improving your workflow efficiency',
      promptTemplate: 'Hi {{first_name}},\n\nI noticed your work as {{title}} at {{company}} and thought there may be a practical way to automate repeatable operational sequences for your team.\n\nWorth a quick look?',
    }
  ]);
  const [wizardGenerating, setWizardGenerating] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [builderGroupSearch, setBuilderGroupSearch] = useState('');
  const [builderContactSearch, setBuilderContactSearch] = useState('');

  const updateCampaignsUrl = useCallback(
    (
      next: {
        page?: number;
        limit?: number;
        status?: CampaignStatusFilter;
        wizard?: boolean;
        step?: number;
      },
      mode: 'push' | 'replace' = 'push',
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      const nextPage = next.page ?? urlPage;
      const nextLimit = next.limit ?? urlLimit;
      const nextStatus = next.status ?? statusFilter;
      const nextWizard = next.wizard ?? wizardOpenFromUrl;
      const nextStep = next.step ?? wizardStepFromUrl;

      params.set('page', String(Math.max(1, nextPage)));
      params.set('limit', String(nextLimit));

      if (nextStatus && nextStatus !== 'all') {
        params.set('status', nextStatus);
      } else {
        params.delete('status');
      }

      if (nextWizard) {
        params.set('wizard', '1');
        params.set('step', String(readWizardStep(String(nextStep))));
      } else {
        params.delete('wizard');
        params.delete('step');
      }

      const nextUrl = `/campaigns?${params.toString()}`;
      if (mode === 'replace') {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [
      router,
      searchParams,
      statusFilter,
      urlLimit,
      urlPage,
      wizardOpenFromUrl,
      wizardStepFromUrl,
    ],
  );

  // Load All Data
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const templates = await campaignsService.getTemplates();
      setCampaignTemplates(templates);

      const camps = await campaignsService.getAll();
      setCampaigns(camps);

      const grps = await groupsService.getAll();
      setGroups(grps);

      const conts = await contactsService.getAll('', 1, 100);
      setContacts(conts.contacts);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load campaigns/contacts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    let changed = false;

    if (params.get('page') !== String(urlPage)) {
      params.set('page', String(urlPage));
      changed = true;
    }
    if (params.get('limit') !== String(urlLimit)) {
      params.set('limit', String(urlLimit));
      changed = true;
    }
    if (
      params.get('status') &&
      !CAMPAIGN_STATUS_FILTERS.includes(params.get('status') as CampaignStatusFilter)
    ) {
      params.delete('status');
      changed = true;
    }
    if (wizardOpenFromUrl && params.get('step') !== String(wizardStepFromUrl)) {
      params.set('step', String(wizardStepFromUrl));
      changed = true;
    }
    if (!wizardOpenFromUrl && params.has('step')) {
      params.delete('step');
      changed = true;
    }

    if (changed) {
      router.replace(`/campaigns?${params.toString()}`, { scroll: false });
    }
  }, [
    queryString,
    router,
    statusFilter,
    urlLimit,
    urlPage,
    wizardOpenFromUrl,
    wizardStepFromUrl,
  ]);

  // Recipient deduplication engine
  useEffect(() => {
    const uniqueRecipients = new Map<string, { id: string; name: string; email: string; source: string }>();

    selectedGroupIds.forEach(groupId => {
      const group = groups.find(g => g.id === groupId);
      if (group) {
        group.contactIds.forEach(contactId => {
          const contact = contacts.find(c => c.id === contactId);
          if (contact && !contact.suppressed) {
            if (!uniqueRecipients.has(contact.id)) {
              uniqueRecipients.set(contact.id, {
                id: contact.id,
                name: contact.name,
                email: contact.email,
                source: `Group: ${group.name}`,
              });
            } else {
              const existing = uniqueRecipients.get(contact.id)!;
              uniqueRecipients.set(contact.id, {
                ...existing,
                source: existing.source + `, Group: ${group.name}`,
              });
            }
          }
        });
      }
    });

    selectedContactIds.forEach(contactId => {
      const contact = contacts.find(c => c.id === contactId);
      if (contact && !contact.suppressed) {
        if (!uniqueRecipients.has(contact.id)) {
          uniqueRecipients.set(contact.id, {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            source: 'Direct Contact',
          });
        } else {
          const existing = uniqueRecipients.get(contact.id)!;
          if (!existing.source.includes('Direct Contact')) {
            uniqueRecipients.set(contact.id, {
              ...existing,
              source: existing.source + ', Direct',
            });
          }
        }
      }
    });

    setEligibleRecipients(Array.from(uniqueRecipients.values()));
  }, [selectedGroupIds, selectedContactIds, groups, contacts]);

  // Handle Outreach Type Change in Wizard
  const handleOutreachTypeChange = (type: keyof typeof OUTREACH_TEMPLATES) => {
    setWizardOutreachType(type);
    const defaults = OUTREACH_TEMPLATES[type];
    const generatedName = `${defaults.name} - ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    setWizardName(generatedName);
    setWizardTone(defaults.tone);
    setWizardSinglePrompt(defaults.generationPrompt);
    
    // Adjust wizard steps using defaults
    const updatedSteps = Array.from({ length: wizardStepsCount }).map((_, idx) => {
      const stepNum = idx + 1;
      if (stepNum === 1) {
        return {
          order: 1,
          delayMinutes: 5,
          subjectTemplate: defaults.subject,
          promptTemplate: defaults.prompt,
        };
      } else {
        return {
          order: stepNum,
          delayMinutes: 1440 * (stepNum - 1), // 1 day, 2 days etc.
          subjectTemplate: `Re: ${defaults.subject}`,
          promptTemplate: `Hi {{first_name}},\n\nFollowing up on my note about ${defaults.subject}. If this is useful for {{company}}, I would be glad to share a quick example.\n\nOpen to a short conversation?`,
        };
      }
    });
    setWizardSteps(updatedSteps);
  };

  const initializeWizard = useCallback((step = 1) => {
    const defaults = OUTREACH_TEMPLATES['sales'];
    setWizardOutreachType('sales');
    const generatedName = `${defaults.name} - ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    setWizardName(generatedName);
    setWizardTone(defaults.tone);
    setWizardSinglePrompt(defaults.generationPrompt);
    setWizardMode('auto');
    setWizardDelayAmount(3);
    setWizardDelayUnit('days');
    setWizardStepsCount(3); // Default to 3 steps for the wizard
    setWizardSelectedGroupIds([]);
    setWizardSelectedContactIds([]);
    setWizardGroupSearch('');
    setWizardContactSearch('');
    setWizardRawImportText('');
    setWizardError(null);
    setWizardStep(step);
    
    // Set 3 default manual steps in case they switch to manual mode!
    const defaultSteps = Array.from({ length: 3 }).map((_, idx) => {
      const stepNum = idx + 1;
      if (stepNum === 1) {
        return {
          order: 1,
          delayMinutes: 5,
          subjectTemplate: defaults.subject,
          promptTemplate: defaults.prompt,
        };
      } else {
        return {
          order: stepNum,
          delayMinutes: 1440 * (stepNum - 1), // 1 day, 2 days etc.
          subjectTemplate: `Re: ${defaults.subject}`,
          promptTemplate: `Hi {{first_name}},\n\nFollowing up on my note about ${defaults.subject}. If this is useful for {{company}}, I would be glad to share a quick example.\n\nOpen to a short conversation?`,
        };
      }
    });
    setWizardSteps(defaultSteps);
    setIsWizardOpen(true);
  }, []);

  const openWizard = () => {
    initializeWizard(1);
    updateCampaignsUrl({ wizard: true, step: 1 });
  };

  const closeWizard = () => {
    setIsWizardOpen(false);
    updateCampaignsUrl({ wizard: false });
  };

  useEffect(() => {
    if (wizardOpenFromUrl && !isWizardOpen) {
      initializeWizard(wizardStepFromUrl);
      return;
    }

    if (!wizardOpenFromUrl && isWizardOpen && !wizardGenerating) {
      setIsWizardOpen(false);
      return;
    }

    if (wizardOpenFromUrl && isWizardOpen && wizardStep !== wizardStepFromUrl) {
      setWizardStep(wizardStepFromUrl);
    }
  }, [
    initializeWizard,
    isWizardOpen,
    wizardGenerating,
    wizardOpenFromUrl,
    wizardStep,
    wizardStepFromUrl,
  ]);

  // Adjust steps count inside Wizard
  const handleWizardStepsCountChange = (count: number) => {
    setWizardStepsCount(count);
    const defaults = OUTREACH_TEMPLATES[wizardOutreachType];
    const updated = Array.from({ length: count }).map((_, idx) => {
      const stepNum = idx + 1;
      if (wizardSteps[idx]) {
        return wizardSteps[idx];
      }
      if (stepNum === 1) {
        return {
          order: 1,
          delayMinutes: 5,
          subjectTemplate: defaults.subject,
          promptTemplate: defaults.prompt,
        };
      } else {
        return {
          order: stepNum,
          delayMinutes: 1440 * (stepNum - 1),
          subjectTemplate: `Re: ${defaults.subject}`,
          promptTemplate: `Hi {{first_name}},\n\nFollowing up on my note about ${defaults.subject}. If this is useful for {{company}}, I would be glad to share a quick example.\n\nOpen to a short conversation?`,
        };
      }
    });
    setWizardSteps(updated);
  };

  // Handle Single-Row Campaign Deletion
  const handleDeleteCampaign = async (id: string) => {
    try {
      await campaignsService.delete(id);
      await loadData();
    } catch (err: any) {
      setLoadError(err.message || 'Failed to delete campaign sequence.');
    }
  };

  const getBackendTemplateForOutreach = (type: keyof typeof OUTREACH_TEMPLATES) => {
    const templateKeyByType: Record<keyof typeof OUTREACH_TEMPLATES, string> = {
      sales: 'cold-intro',
      recruiting: 'warm-follow-up',
      partnership: 'event-networking',
    };

    return (
      campaignTemplates.find((template) => template.key === templateKeyByType[type]) ||
      campaignTemplates[0]
    );
  };

  const buildAudienceDescription = (directContactCount: number) => {
    const parts = [
      `Campaign type: ${OUTREACH_TEMPLATES[wizardOutreachType].name}`,
      `${wizardSelectedGroupIds.length} selected group(s)`,
      `${directContactCount} selected or imported direct contact(s)`,
    ];

    return parts.join('. ');
  };

  // Create Campaign via Wizard Flow
  const handleWizardCreate = async () => {
    setWizardError(null);
    setWizardGenerating(true);

    try {
      // 1. Process Quick Imported Contacts first (Format: Name, Email, Company, Title)
      const importedIds: string[] = [];
      if (wizardRawImportText.trim()) {
        const lines = wizardRawImportText.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.split(',');
          const name = parts[0]?.trim();
          const email = parts[1]?.trim() || parts[0]?.trim();
          
          if (name && email && email.includes('@')) {
            const existing = contacts.find(c => c.email.toLowerCase() === email.toLowerCase());
            if (existing) {
              importedIds.push(existing.id);
            } else {
              try {
                const newContact = await contactsService.create({
                  name,
                  email,
                  company: parts[2]?.trim() || '',
                  title: parts[3]?.trim() || '',
                });
                importedIds.push(newContact.id);
              } catch (err) {
                console.error('Failed to quick-register contact:', err);
              }
            }
          }
        }
      }

      const finalContactIds = Array.from(new Set([...wizardSelectedContactIds, ...importedIds]));

      // Validations
      if (!wizardName.trim()) {
        throw new Error('Please specify a campaign name.');
      }
      if (wizardSelectedGroupIds.length === 0 && finalContactIds.length === 0) {
        throw new Error('Please select target segments, contacts, or input custom contacts to import.');
      }

      let camp: Campaign;
      if (wizardMode === 'auto') {
        const backendTemplate = getBackendTemplateForOutreach(wizardOutreachType);
        if (!backendTemplate) {
          throw new Error('Campaign templates are not available yet. Please refresh and try again.');
        }

        const defaults = OUTREACH_TEMPLATES[wizardOutreachType];
        const goal = [
          wizardSinglePrompt.trim() || defaults.description,
          `Desired cadence: ${wizardDelayAmount} ${wizardDelayUnit} between follow-up steps.`,
        ].join('\n');

        camp = await campaignsService.generateDraft({
          name: wizardName.trim(),
          goal,
          audienceDescription: buildAudienceDescription(finalContactIds.length),
          templateId: backendTemplate.id,
          tone: wizardTone,
          maxSteps: Math.min(4, Math.max(1, wizardStepsCount)),
          targetGroupIds: wizardSelectedGroupIds,
          targetContactIds: finalContactIds,
        });
      } else {
        camp = await campaignsService.create({
          name: wizardName.trim(),
          targetGroupIds: wizardSelectedGroupIds,
          targetContactIds: finalContactIds,
          sequenceSteps: wizardSteps.slice(0, 4),
        });
      }

      // Close modal and route directly to the draft review page.
      setIsWizardOpen(false);
      setWizardStep(1);
      setWizardRawImportText('');
      setWizardSelectedGroupIds([]);
      setWizardSelectedContactIds([]);
      setWizardGroupSearch('');
      setWizardContactSearch('');
      setWizardStepsCount(1);
      
      router.push(`/campaigns/${camp.id}`);
    } catch (err: any) {
      setWizardError(err.message || 'Failed to generate campaign sequence.');
    } finally {
      setWizardGenerating(false);
    }
  };

  const handleCoreContactToggle = (contactId: string) => {
    setCoreContactIds((prev) =>
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : [...prev, contactId],
    );
  };

  const handleCoreGroupToggle = (groupId: string) => {
    setCoreGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId],
    );
  };

  const handleCoreCreateCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    setCoreError(null);

    if (!coreName.trim()) {
      setCoreError('Campaign name is required.');
      return;
    }
    if (!corePromptTemplate.trim()) {
      setCoreError('Prompt template is required.');
      return;
    }
    if (coreGroupIds.length === 0 && coreContactIds.length === 0) {
      setCoreError('Select at least one group or contact.');
      return;
    }

    setCoreCreating(true);
    try {
      const campaign = await campaignsService.create({
        name: coreName.trim(),
        promptTemplate: corePromptTemplate.trim(),
        targetGroupIds: coreGroupIds,
      });
      if (coreContactIds.length) {
        await campaignsService.attachContacts(campaign.id, coreContactIds);
      }
      if (coreGroupIds.length) {
        await campaignsService.generateSequence(campaign.id);
      }

      setCoreName('');
      setCorePromptTemplate(DEFAULT_CORE_PROMPT_TEMPLATE);
      setCoreGroupIds([]);
      setCoreContactIds([]);
      setCoreGroupSearch('');
      setCoreContactSearch('');
      router.push(`/campaigns/${campaign.id}`);
    } catch (err: any) {
      setCoreError(err.message || 'Failed to create campaign.');
    } finally {
      setCoreCreating(false);
    }
  };

  // Triggering Manual Campaign Builder
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!campaignName.trim()) {
      setCreateError('Campaign name is required.');
      return;
    }
    if (eligibleRecipients.length === 0) {
      setCreateError('Campaign must have at least one valid recipient targeted.');
      return;
    }
    if (sequenceSteps.length === 0) {
      setCreateError('Campaign must have at least one sequence step defined.');
      return;
    }

    setCreating(true);
    try {
      await campaignsService.create({
        name: campaignName.trim(),
        targetGroupIds: selectedGroupIds,
        targetContactIds: selectedContactIds,
        sequenceSteps,
      });

      setCampaignName('');
      setSelectedGroupIds([]);
      setSelectedContactIds([]);
      setBuilderGroupSearch('');
      setBuilderContactSearch('');
      setSequenceSteps([
        {
          order: 1,
          delayMinutes: 5,
          subjectTemplate: 'Improving your workflow efficiency',
          promptTemplate: 'Hi {{first_name}},\n\nI noticed your work as {{title}} at {{company}} and thought there may be a practical way to automate repeatable operational sequences for your team.\n\nWorth a quick look?',
        }
      ]);

      await loadData();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create campaign draft.');
    } finally {
      setCreating(false);
    }
  };

  const handleGroupToggle = (groupId: string) => {
    setSelectedGroupIds(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleContactToggle = (contactId: string) => {
    setSelectedContactIds(prev =>
      prev.includes(contactId) ? prev.filter(id => id !== contactId) : [...prev, contactId]
    );
  };

  const addStep = () => {
    const nextOrder = sequenceSteps.length + 1;
    setSequenceSteps([...sequenceSteps, {
      order: nextOrder,
      delayMinutes: 1440,
      subjectTemplate: `Follow up: step ${nextOrder}`,
      promptTemplate: `Hi {{first_name}},\n\nFollowing up in case this is relevant for {{company}}. I can keep it brief and share a concrete example.\n\nWould that be useful?`,
    }]);
  };

  const updateStep = (index: number, field: keyof BuilderStep, value: any) => {
    const updated = [...sequenceSteps];
    updated[index] = { ...updated[index], [field]: value };
    setSequenceSteps(updated);
  };

  const removeStep = (index: number) => {
    if (sequenceSteps.length <= 1) return;
    const filtered = sequenceSteps.filter((_, idx) => idx !== index);
    const adjusted = filtered.map((step, idx) => ({ ...step, order: idx + 1 }));
    setSequenceSteps(adjusted);
  };

  const filteredCampaigns = campaigns.filter((campaign) =>
    statusFilter === 'all' ? true : campaign.status === statusFilter,
  );
  const campaignPageCount = Math.max(
    1,
    Math.ceil(filteredCampaigns.length / urlLimit),
  );
  const campaignPage = Math.min(urlPage, campaignPageCount);
  const paginatedCampaigns = filteredCampaigns.slice(
    (campaignPage - 1) * urlLimit,
    campaignPage * urlLimit,
  );

  const filteredCoreGroups = useMemo(
    () =>
      groups.filter((group) =>
        matchesSearch(coreGroupSearch, [
          group.name,
          group.description,
          group.memberCount,
        ]),
      ),
    [coreGroupSearch, groups],
  );

  const filteredCoreContacts = useMemo(
    () =>
      contacts.filter((contact) =>
        matchesSearch(coreContactSearch, [
          contact.name,
          contact.email,
          contact.company,
          contact.title,
        ]),
      ),
    [contacts, coreContactSearch],
  );

  const filteredBuilderGroups = useMemo(
    () =>
      groups.filter((group) =>
        matchesSearch(builderGroupSearch, [
          group.name,
          group.description,
          group.memberCount,
        ]),
      ),
    [builderGroupSearch, groups],
  );

  const filteredBuilderContacts = useMemo(
    () =>
      contacts.filter((contact) =>
        matchesSearch(builderContactSearch, [
          contact.name,
          contact.email,
          contact.company,
          contact.title,
        ]),
      ),
    [builderContactSearch, contacts],
  );

  const filteredWizardGroups = useMemo(
    () =>
      groups.filter((group) =>
        matchesSearch(wizardGroupSearch, [
          group.name,
          group.description,
          group.memberCount,
        ]),
      ),
    [groups, wizardGroupSearch],
  );

  const filteredWizardContacts = useMemo(
    () =>
      contacts.filter((contact) =>
        matchesSearch(wizardContactSearch, [
          contact.name,
          contact.email,
          contact.company,
          contact.title,
        ]),
      ),
    [contacts, wizardContactSearch],
  );

  useEffect(() => {
    if (!loading && filteredCampaigns.length > 0 && campaignPage !== urlPage) {
      updateCampaignsUrl({ page: campaignPage }, 'replace');
    }
  }, [
    campaignPage,
    filteredCampaigns.length,
    loading,
    updateCampaignsUrl,
    urlPage,
  ]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-slate-50 text-slate-600 border-slate-200/60';
      case 'generating': return 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse';
      case 'running': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
      case 'completed': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'failed': return 'bg-rose-50 text-rose-700 border-rose-100';
      default: return 'bg-slate-50 text-slate-500';
    }
  };

  return (
    <Shell>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-5 mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-sans font-bold tracking-tight text-slate-950">
            Campaign Sequences
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Build multi-step drip email templates triggered dynamically using placeholder variables
          </p>
        </div>
        
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center justify-center p-2.5 border border-slate-200 rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 transition-colors shadow-sm cursor-pointer"
            title="Refresh Registry"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          
          <button
            onClick={openWizard}
            className="flex-1 sm:flex-none inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-100 transition-all cursor-pointer active:scale-95"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Campaign Wizard
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-8 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center">
          <AlertCircle className="h-5 w-5 mr-2 text-red-500" />
          <span>{loadError}</span>
        </div>
      )}

      {SHOW_LEGACY_CAMPAIGN_FORMS && (
      <section className="mb-10 border-b border-slate-200 pb-10">
        <div className="mb-5">
          <h2 className="text-sm font-sans font-bold text-slate-900 uppercase tracking-wider">
            Create Campaign
          </h2>
        </div>

        {coreError && (
          <div className="mb-5 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 shrink-0 text-red-500" />
            <span>{coreError}</span>
          </div>
        )}

        <form onSubmit={handleCoreCreateCampaign} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                Campaign Name *
              </label>
              <input
                type="text"
                required
                value={coreName}
                onChange={(event) => setCoreName(event.target.value)}
                placeholder="Q3 founder outreach"
                className="w-full px-3 py-2.5 border border-slate-200 bg-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                Groups
              </label>
              {groups.length === 0 ? (
                <div className="text-xs text-slate-400 italic">No groups available.</div>
              ) : (
                <div className="space-y-2 max-h-36 overflow-y-auto p-3 border border-slate-200/80 rounded-xl bg-white">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                    <input
                      type="text"
                      value={coreGroupSearch}
                      onChange={(event) => setCoreGroupSearch(event.target.value)}
                      placeholder="Search groups..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-2 pl-8 pr-3 text-xs font-medium text-slate-700 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  {filteredCoreGroups.length === 0 ? (
                    <div className="py-3 text-center text-xs font-semibold text-slate-400">
                      No groups match that search.
                    </div>
                  ) : (
                    filteredCoreGroups.map((group) => (
                      <label
                        key={group.id}
                        className="flex items-center space-x-2.5 text-xs text-slate-700 select-none transition-colors cursor-pointer hover:text-indigo-600"
                      >
                        <input
                          type="checkbox"
                          checked={coreGroupIds.includes(group.id)}
                          onChange={() => handleCoreGroupToggle(group.id)}
                          className="h-4 w-4 text-indigo-600 accent-indigo-600 border-slate-300 rounded focus:ring-0"
                        />
                        <span className="font-semibold">
                          {group.name} ({group.memberCount} contacts)
                        </span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                Contacts
              </label>
              {contacts.length === 0 ? (
                <div className="text-xs text-slate-400 italic">No contacts available.</div>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto p-3 border border-slate-200/80 rounded-xl bg-white">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                    <input
                      type="text"
                      value={coreContactSearch}
                      onChange={(event) => setCoreContactSearch(event.target.value)}
                      placeholder="Search contacts..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-2 pl-8 pr-3 text-xs font-medium text-slate-700 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  {filteredCoreContacts.length === 0 ? (
                    <div className="py-3 text-center text-xs font-semibold text-slate-400">
                      No contacts match that search.
                    </div>
                  ) : (
                    filteredCoreContacts.map((contact) => (
                      <label
                        key={contact.id}
                        className={`flex items-center space-x-2.5 text-xs text-slate-700 select-none transition-colors ${
                          contact.suppressed ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:text-indigo-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={contact.suppressed}
                          checked={coreContactIds.includes(contact.id)}
                          onChange={() => handleCoreContactToggle(contact.id)}
                          className="h-4 w-4 text-indigo-600 accent-indigo-600 border-slate-300 rounded focus:ring-0 disabled:border-slate-200"
                        />
                        <span className="font-semibold">
                          {contact.name} {contact.suppressed ? '(Suppressed)' : `(${contact.email})`}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                Prompt Template *
              </label>
              <div className="mb-2 flex flex-wrap gap-2">
                {CORE_PROMPT_TEMPLATES.map((template) => {
                  const isSelected = corePromptTemplate === template.value;
                  return (
                    <button
                      key={template.label}
                      type="button"
                      onClick={() => setCorePromptTemplate(template.value)}
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                      }`}
                    >
                      {template.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                required
                value={corePromptTemplate}
                onChange={(event) => setCorePromptTemplate(event.target.value)}
                rows={6}
                className="w-full px-3 py-2.5 border border-slate-200 bg-white rounded-xl text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
              />
              <p className="mt-2 text-[11px] text-slate-400">
                Supported placeholders: {'{{name}}'}, {'{{email}}'}, {'{{company}}'}, {'{{title}}'}.
              </p>
            </div>

            <button
              type="submit"
              disabled={coreCreating}
              className="inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
            >
              {coreCreating ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5 mr-2" />
                  Creating Campaign...
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-2" />
                  Create Campaign
                </>
              )}
            </button>
          </div>
        </form>
      </section>
      )}

      {/* Main Grid: Active Campaigns list on top / left */}
      <div className="space-y-12">
        
        {/* Section 1: Existing Campaigns */}
        <div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-sans font-bold text-slate-400 uppercase tracking-wider">
              Active Outreach Campaigns
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(event) =>
                  updateCampaignsUrl({
                    page: 1,
                    status: event.target.value as CampaignStatusFilter,
                  })
                }
                className="px-2.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                aria-label="Campaign status filter"
              >
                {CAMPAIGN_STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? 'All statuses' : status}
                  </option>
                ))}
              </select>
              <select
                value={urlLimit}
                onChange={(event) =>
                  updateCampaignsUrl({ page: 1, limit: Number(event.target.value) })
                }
                className="px-2.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                aria-label="Campaigns per page"
              >
                {CAMPAIGN_LIMITS.map((limit) => (
                  <option key={limit} value={limit}>
                    {limit} / page
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {loading ? (
              <div className="py-24 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin mb-2 text-indigo-500" />
                <span className="text-xs font-semibold text-slate-500">Loading campaign registry...</span>
              </div>
            ) : campaigns.length === 0 ? (
              /* CLEAN CENTERED EMPTY STATE FOR THE WIZARD */
              <div className="py-20 text-center max-w-md mx-auto space-y-5">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500 shadow-sm">
                  <Sparkles className="h-5 w-5 animate-pulse" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-slate-900 font-sans">No campaign sequences found</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Set up your first outreach drip sequence using our dynamic Campaign Wizard. Define templates, target audience, and generate tailored sequences instantly.
                  </p>
                </div>
                <div>
                  <button
                    onClick={openWizard}
                    className="inline-flex items-center px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-100 transition-all cursor-pointer active:scale-95"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Campaign
                  </button>
                </div>
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="py-20 text-center max-w-md mx-auto space-y-3">
                <h3 className="text-base font-bold text-slate-900 font-sans">No campaigns match this filter</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Change the status filter to show a different campaign set.
                </p>
                <button
                  onClick={() => updateCampaignsUrl({ page: 1, status: 'all' })}
                  className="inline-flex items-center px-4 py-2 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50"
                >
                  Clear Filter
                </button>
              </div>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-55 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-6 py-4">Campaign Name</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Target segment size</th>
                        <th className="px-6 py-4">Sequence Steps</th>
                        <th className="px-6 py-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-700 text-sm">
                      {paginatedCampaigns.map((camp) => (
                        <tr key={camp.id} className="hover:bg-indigo-50/10 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-semibold text-slate-900">{camp.name}</div>
                            <div className="text-xs text-slate-400 font-medium mt-0.5">
                              {camp.contacts.length} attached contacts
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${getStatusColor(camp.status)}`}>
                              {camp.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-500 font-medium">
                            {camp.status === 'draft' || camp.status === 'generating' ? (
                              <span className="text-xs text-slate-500">
                                {camp.targetGroupIds.length} groups · {camp.contacts.length} contacts
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-xs">
                                <Users className="h-3.5 w-3.5 mr-1 text-slate-400" />
                                {camp.recipients ? camp.recipients.length : 0} recipients
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 font-semibold text-slate-800">
                            <span className="inline-flex items-center px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold">
                              <ListOrdered className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                              {camp.sequenceSteps ? camp.sequenceSteps.length : 0} steps
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                 href={`/campaigns/${camp.id}`}
                                 className="inline-flex items-center px-3.5 py-2 border border-slate-200 text-xs font-bold rounded-xl text-indigo-600 bg-white hover:bg-indigo-50/50 hover:border-indigo-100 transition-all shadow-sm"
                              >
                                 Open Sequence
                                 <ChevronRight className="ml-1 h-3.5 w-3.5" />
                              </Link>
                              <button
                                onClick={() => handleDeleteCampaign(camp.id)}
                                className="p-2 border border-slate-200 hover:border-red-100 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50/50 transition-all cursor-pointer"
                                title="Delete Sequence"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {campaignPageCount > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
                    <div className="text-xs text-slate-400 font-medium">
                      Showing page <span className="text-slate-700 font-semibold">{campaignPage}</span> of <span className="text-slate-700 font-semibold">{campaignPageCount}</span> ({filteredCampaigns.length} matching campaigns)
                    </div>
                    <div className="flex space-x-2">
                      <button
                        disabled={campaignPage <= 1}
                        onClick={() => updateCampaignsUrl({ page: Math.max(campaignPage - 1, 1) })}
                        className="px-3.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 transition-colors"
                      >
                        Previous
                      </button>
                      <button
                        disabled={campaignPage >= campaignPageCount}
                        onClick={() => updateCampaignsUrl({ page: Math.min(campaignPage + 1, campaignPageCount) })}
                        className="px-3.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Campaign Builder (Visible only when lists exist or as backup) */}
        {SHOW_LEGACY_CAMPAIGN_FORMS && campaigns.length > 0 && (
          <div className="border-t border-slate-200 pt-10">
            <div className="mb-6">
              <h2 className="text-lg font-sans font-bold text-slate-900 tracking-tight">
                Interactive Campaign Drip Builder
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Build sequence templates, customize targeting segments, and launch your automated email campaign
              </p>
            </div>

            {createError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center">
                <AlertCircle className="h-5 w-5 mr-2 shrink-0 text-red-500" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Left Box: Campaign Metadata & Targeting (1/3 cols) */}
              <div className="lg:col-span-1 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
                <h3 className="text-sm font-sans font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-3">
                  1. Campaign Settings
                </h3>

                {/* Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                    Campaign Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="E.g., Q3 Product Outbound Pitch"
                    className="w-full px-3 py-2.5 border border-slate-200 bg-slate-50/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                  />
                </div>

                {/* Targeting segments */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                    Target Segments (Groups)
                  </label>
                  {groups.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">No segment groups available. Create one in Groups page first.</div>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto p-3 border border-slate-200/80 rounded-xl bg-slate-50/30">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                        <input
                          type="text"
                          value={builderGroupSearch}
                          onChange={(event) => setBuilderGroupSearch(event.target.value)}
                          placeholder="Search groups..."
                          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-medium text-slate-700 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                      {filteredBuilderGroups.length === 0 ? (
                        <div className="py-3 text-center text-xs font-semibold text-slate-400">
                          No groups match that search.
                        </div>
                      ) : (
                        filteredBuilderGroups.map(group => (
                          <label key={group.id} className="flex items-center space-x-2.5 text-xs text-slate-700 cursor-pointer select-none hover:text-indigo-600 transition-colors">
                            <input
                              type="checkbox"
                              checked={selectedGroupIds.includes(group.id)}
                              onChange={() => handleGroupToggle(group.id)}
                              className="h-4 w-4 text-indigo-600 accent-indigo-600 border-slate-300 rounded focus:ring-0"
                            />
                            <span className="font-semibold">{group.name} ({group.memberCount} members)</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Targeting direct contacts */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                    Direct Target Contacts
                  </label>
                  {contacts.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">No contacts available. Create some in Contacts page.</div>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto p-3 border border-slate-200/80 rounded-xl bg-slate-50/30">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                        <input
                          type="text"
                          value={builderContactSearch}
                          onChange={(event) => setBuilderContactSearch(event.target.value)}
                          placeholder="Search contacts..."
                          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-medium text-slate-700 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                      {filteredBuilderContacts.length === 0 ? (
                        <div className="py-3 text-center text-xs font-semibold text-slate-400">
                          No contacts match that search.
                        </div>
                      ) : (
                        filteredBuilderContacts.map(contact => (
                          <label
                            key={contact.id}
                            className={`flex items-center space-x-2.5 text-xs text-slate-700 select-none transition-colors hover:text-indigo-600 ${contact.suppressed ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <input
                              type="checkbox"
                              disabled={contact.suppressed}
                              checked={selectedContactIds.includes(contact.id)}
                              onChange={() => handleContactToggle(contact.id)}
                              className="h-4 w-4 text-indigo-600 accent-indigo-600 border-slate-300 rounded focus:ring-0 disabled:border-slate-200"
                            />
                            <span className="font-semibold">
                              {contact.name} {contact.suppressed ? '(Suppressed)' : `(${contact.email})`}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Middle/Right Box: Sequence steps (2/3 cols) */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Sequence Block */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-sans font-bold text-slate-900 uppercase tracking-wider">
                      2. Sequence drip steps
                    </h3>
                    <button
                      type="button"
                      onClick={addStep}
                      className="inline-flex items-center px-3.5 py-1.5 border border-indigo-200 text-xs font-bold rounded-xl text-indigo-600 bg-indigo-50/50 hover:bg-indigo-50 hover:text-indigo-700 transition-all cursor-pointer"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Drip Step
                    </button>
                  </div>

                  <div className="space-y-6">
                    {sequenceSteps.map((step, index) => (
                      <div key={index} className="p-4 border border-slate-200 bg-slate-50/40 rounded-xl space-y-4 relative">
                        
                        {/* Step Header */}
                        <div className="flex justify-between items-center">
                          <span className="inline-flex items-center px-2.5 py-0.5 bg-indigo-600 text-white font-mono text-[10px] font-bold rounded-lg shadow-sm">
                            STEP {step.order}
                          </span>
                          {sequenceSteps.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeStep(index)}
                              className="p-1.5 text-slate-400 hover:text-red-600 transition-colors cursor-pointer rounded-lg hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        {/* Subject and Delay */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                              Subject Line Template
                            </label>
                            <input
                              type="text"
                              required
                              value={step.subjectTemplate}
                              onChange={(e) => updateStep(index, 'subjectTemplate', e.target.value)}
                              placeholder="E.g., Connect with ${contactName}"
                              className="w-full px-3 py-2 border border-slate-200 bg-white rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                              Delay
                            </label>
                            <div className="flex gap-1.5">
                              <input
                                type="number"
                                required
                                min={1}
                                value={getDelayFields(step.delayMinutes).amount}
                                onChange={(e) => {
                                  const amount = Math.max(1, parseInt(e.target.value, 10) || 1);
                                  const unit = getDelayFields(step.delayMinutes).unit;
                                  updateStep(index, 'delayMinutes', getMinutesFromFields(amount, unit));
                                }}
                                className="w-14 px-2 py-2 border border-slate-200 bg-white rounded-xl text-xs font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500"
                              />
                              <select
                                value={getDelayFields(step.delayMinutes).unit}
                                onChange={(e) => {
                                  const amount = getDelayFields(step.delayMinutes).amount;
                                  const unit = e.target.value as any;
                                  updateStep(index, 'delayMinutes', getMinutesFromFields(amount, unit));
                                }}
                                className="flex-1 px-2.5 py-2 border border-slate-200 bg-white rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500"
                              >
                                <option value="minutes">Minutes</option>
                                <option value="hours">Hours</option>
                                <option value="days">Days</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Email Body Template */}
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                              Email Body Template
                            </label>
                            <span className="text-[9px] text-slate-400 font-medium">
                              Supported: <code className="bg-slate-100 text-slate-600 px-0.5 font-mono">${`{contactName}`}</code>, <code className="bg-slate-100 text-slate-600 px-0.5 font-mono">${`{contactCompany}`}</code>, <code className="bg-slate-100 text-slate-600 px-0.5 font-mono">${`{contactTitle}`}</code>
                            </span>
                          </div>
                          <textarea
                            required
                            value={step.promptTemplate}
                            onChange={(e) => updateStep(index, 'promptTemplate', e.target.value)}
                            placeholder="Hi {{first_name}}, following up in case this is useful for {{company}}..."
                            rows={3}
                            className="w-full px-3 py-2 border border-slate-200 bg-white rounded-xl text-xs leading-relaxed text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                          />
                        </div>

                      </div>
                    ))}
                  </div>
                </div>

                {/* Recipient preview pane */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-sans font-bold text-slate-900 uppercase tracking-wider flex items-center">
                      3. Recipient preview
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 border border-indigo-100 text-indigo-750">
                        {eligibleRecipients.length} eligible
                      </span>
                    </h3>
                  </div>

                  {eligibleRecipients.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs italic bg-slate-50/40 rounded-xl border border-slate-200/60">
                      No recipients selected yet. Check targeted segments or direct contacts on the left to pre-deduplicate.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto shadow-sm">
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-slate-55 border-b border-slate-200 font-bold uppercase text-slate-400 tracking-wider sticky top-0">
                            <th className="px-4 py-2.5">Name</th>
                            <th className="px-4 py-2.5">Email</th>
                            <th className="px-4 py-2.5">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-slate-600">
                          {eligibleRecipients.map(recipient => (
                            <tr key={recipient.id} className="hover:bg-indigo-50/10 transition-colors">
                              <td className="px-4 py-2.5 font-semibold text-slate-900">{recipient.name}</td>
                              <td className="px-4 py-2.5 font-mono text-slate-500">{recipient.email}</td>
                              <td className="px-4 py-2.5">
                                <span className="px-2 py-0.5 bg-slate-50 border border-slate-200/60 rounded-md text-[10px] font-semibold text-slate-500">
                                  {recipient.source}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Action Submit */}
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={creating || eligibleRecipients.length === 0 || sequenceSteps.length === 0}
                    className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer active:scale-[0.98]"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="animate-spin h-4 w-4 mr-2" />
                        Creating Draft Campaign...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Save Campaign Drip Draft
                      </>
                    )}
                  </button>
                </div>

              </div>

            </form>
          </div>
        )}

      </div>

      {/* CAMPAIGN WIZARD DIALOG MODAL (COMPLETELY INTEGRATED AND ANIMATED) */}
      <AnimatePresence>
        {isWizardOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-white border border-slate-200/80 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh] overflow-hidden"
            >
              {/* Wizard Header */}
              <div className="px-6 py-4.5 border-b border-slate-150 flex justify-between items-center bg-slate-50/50">
                <div>
                  <h3 className="text-sm font-sans font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-4.5 w-4.5 text-indigo-500" />
                    Campaign Creation Wizard
                  </h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <div 
                        key={s} 
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          s === wizardStep 
                            ? 'w-6 bg-indigo-600' 
                            : s < wizardStep 
                              ? 'w-2 bg-indigo-200' 
                              : 'w-2 bg-slate-200'
                        }`}
                      />
                    ))}
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide ml-2">
                      Step {wizardStep} of 5
                    </span>
                  </div>
                </div>
                
                <button
                  onClick={closeWizard}
                  disabled={wizardGenerating}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Wizard Body (Scrollable Content) */}
              <div className="p-6 overflow-y-auto flex-1 space-y-5">
                {wizardError && (
                  <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-600 font-semibold flex items-center">
                    <AlertCircle className="h-4.5 w-4.5 mr-2 shrink-0 text-rose-500" />
                    <span>{wizardError}</span>
                  </div>
                )}

                {/* STEP 1: Outreach Goal / Channel Selection */}
                {wizardStep === 1 && (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step 1: Choose Campaign Outreach Goal</h4>
                      <p className="text-xs text-slate-500">Pick the primary objective of your outreach sequence to pre-configure strong drip templates and default tones.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {Object.values(OUTREACH_TEMPLATES).map((template) => {
                        const isSelected = wizardOutreachType === template.id;
                        return (
                          <div
                            key={template.id}
                            onClick={() => handleOutreachTypeChange(template.id as any)}
                            className={`border rounded-2xl overflow-hidden cursor-pointer transition-all flex flex-col select-none bg-white ${
                              isSelected 
                                ? 'border-indigo-600 ring-2 ring-indigo-50 shadow-md' 
                                : 'border-slate-200 hover:border-slate-350 hover:shadow-sm'
                            }`}
                          >
                            <div className="relative w-full h-32 border-b border-slate-100">
                              <Image 
                                src={template.coverImage} 
                                alt={template.name} 
                                fill
                                sizes="(max-width: 768px) 100vw, 33vw"
                                referrerPolicy="no-referrer"
                                className="object-cover"
                              />
                            </div>
                            <div className="p-4 flex-1 flex flex-col justify-between space-y-2">
                              <div>
                                <span className="block text-xs font-bold text-slate-900 leading-snug">{template.name}</span>
                                <p className="text-[10px] text-slate-500 leading-normal mt-1">{template.description}</p>
                              </div>
                              <div className="flex justify-end pt-1">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                  isSelected ? 'bg-indigo-650 text-white' : 'bg-slate-50 border border-slate-200 text-slate-500'
                                }`}>
                                  {isSelected ? 'Selected' : 'Select'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* STEP 3: Sequence Metadata (Name & Tone) */}
                {wizardStep === 3 && (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step 3: Campaign Settings & Identity</h4>
                      <p className="text-xs text-slate-500">Define a descriptive name, choose linguistic tone, and choose how to build this campaign.</p>
                    </div>

                    <div className="space-y-4 pt-1">
                      {/* Name Input */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Campaign Sequence Name
                        </label>
                        <input
                          type="text"
                          required
                          value={wizardName}
                          onChange={(e) => setWizardName(e.target.value)}
                          placeholder="E.g., Autumn Venture Capital Outreach"
                          className="w-full px-3.5 py-3 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 bg-slate-50/30 transition-all"
                        />
                      </div>

                      {/* Build Mode Selector */}
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Campaign Build Mode
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setWizardMode('auto')}
                            className={`p-3.5 text-left rounded-xl border transition-all cursor-pointer flex flex-col ${
                              wizardMode === 'auto' 
                                ? 'bg-indigo-50/10 border-indigo-600 ring-1 ring-indigo-50 shadow-sm' 
                                : 'bg-white border-slate-200 hover:border-slate-350'
                            }`}
                          >
                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                              Auto-Generate with AI
                            </span>
                            <span className="text-[10px] text-slate-500 mt-1 leading-normal font-medium">
                              Supply one single prompt instruction. AI automatically generates all follow-up sequence steps.
                            </span>
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => setWizardMode('manual')}
                            className={`p-3.5 text-left rounded-xl border transition-all cursor-pointer flex flex-col ${
                              wizardMode === 'manual' 
                                ? 'bg-indigo-50/10 border-indigo-600 ring-1 ring-indigo-50 shadow-sm' 
                                : 'bg-white border-slate-200 hover:border-slate-350'
                            }`}
                          >
                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <ListOrdered className="h-3.5 w-3.5 text-indigo-500" />
                              Manually Create Steps
                            </span>
                            <span className="text-[10px] text-slate-500 mt-1 leading-normal font-medium">
                              Define subject line templates, delay durations, and exact email bodies for each follow-up step.
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Tone Selections */}
                      <div className="space-y-2 pt-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Select Email Tone
                        </label>
                        <div className="grid grid-cols-5 gap-2">
                          {['Professional', 'Casual', 'Direct', 'Warm', 'Creative'].map((tone) => {
                            const isSelected = wizardTone === tone;
                            return (
                              <button
                                key={tone}
                                type="button"
                                onClick={() => setWizardTone(tone)}
                                className={`py-2 px-1 text-center rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                                  isSelected 
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' 
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-350'
                                }`}
                              >
                                {tone}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 2: Targeting Selections & Copy-Paste Imports */}
                {wizardStep === 2 && (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step 2: Select & Import Target Audience</h4>
                      <p className="text-xs text-slate-500">Map segment groups, direct registry contacts, or copy-paste quick contacts directly into this outreach.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      {/* Left: Checkboxes */}
                      <div className="space-y-3.5 p-4 border border-slate-150 rounded-xl bg-slate-50/10">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                            Select Group Segments
                          </label>
                          {groups.length === 0 ? (
                            <span className="text-[11px] text-slate-400 italic">No groups. Set up groups first.</span>
                          ) : (
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                              <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                                <input
                                  type="text"
                                  value={wizardGroupSearch}
                                  onChange={(event) => setWizardGroupSearch(event.target.value)}
                                  placeholder="Search groups..."
                                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-medium text-slate-700 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                />
                              </div>
                              {filteredWizardGroups.length === 0 ? (
                                <div className="py-3 text-center text-xs font-semibold text-slate-400">
                                  No groups match that search.
                                </div>
                              ) : (
                                filteredWizardGroups.map(group => (
                                  <label key={group.id} className="flex items-center space-x-2.5 text-xs text-slate-700 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={wizardSelectedGroupIds.includes(group.id)}
                                      onChange={() => setWizardSelectedGroupIds(prev =>
                                        prev.includes(group.id) ? prev.filter(id => id !== group.id) : [...prev, group.id]
                                      )}
                                      className="h-4 w-4 text-indigo-600 accent-indigo-600 border-slate-300 rounded"
                                    />
                                    <span className="font-semibold">{group.name} ({group.memberCount} members)</span>
                                  </label>
                                ))
                              )}
                            </div>
                          )}
                        </div>

                        <div className="border-t border-slate-200/60 pt-3">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                            Select Registry Contacts
                          </label>
                          {contacts.length === 0 ? (
                            <span className="text-[11px] text-slate-400 italic">No contacts registered yet.</span>
                          ) : (
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                              <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                                <input
                                  type="text"
                                  value={wizardContactSearch}
                                  onChange={(event) => setWizardContactSearch(event.target.value)}
                                  placeholder="Search contacts..."
                                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-medium text-slate-700 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                />
                              </div>
                              {filteredWizardContacts.length === 0 ? (
                                <div className="py-3 text-center text-xs font-semibold text-slate-400">
                                  No contacts match that search.
                                </div>
                              ) : (
                                filteredWizardContacts.map(c => (
                                  <label key={c.id} className="flex items-center space-x-2.5 text-xs text-slate-700 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={wizardSelectedContactIds.includes(c.id)}
                                      onChange={() => setWizardSelectedContactIds(prev =>
                                        prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                                      )}
                                      className="h-4 w-4 text-indigo-600 accent-indigo-600 border-slate-300 rounded"
                                    />
                                    <span className="font-semibold">{c.name} ({c.company || 'Direct'})</span>
                                  </label>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Raw Paste Area */}
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                          <span>Quick Import New Contacts</span>
                          <span className="text-[9px] font-medium text-slate-400 font-sans">Name, Email, Company, Title</span>
                        </label>
                        <textarea
                          value={wizardRawImportText}
                          onChange={(e) => setWizardRawImportText(e.target.value)}
                          placeholder="Paste a list of custom targets. E.g.:&#13;John Wick, john@assassin.net, Continental, Security&#13;Vance Astro, vance@guardians.org, Guardians, Captain"
                          rows={10}
                          className="w-full p-3 border border-slate-200 rounded-xl text-xs font-mono leading-relaxed bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 resize-none h-full max-h-[235px]"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 4: AI Sequence Prompt / Drip customizer */}
                {wizardStep === 4 && (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step 4: AI Sequence Configuration</h4>
                      <p className="text-xs text-slate-500">Provide one master instruction for the whole campaign, choose sequence length, and default delay interval.</p>
                    </div>

                    {wizardMode === 'auto' ? (
                      <div className="space-y-4 pt-1">
                        {/* One prompt for all sequences */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              AI Sequence Generation Prompt
                            </label>
                            <span className="text-[9px] text-slate-400 font-medium">
                              One prompt generates all selected follow-up steps.
                            </span>
                          </div>
                          <textarea
                            required
                            value={wizardSinglePrompt}
                            onChange={(e) => setWizardSinglePrompt(e.target.value)}
                            placeholder="Tell the AI what sequence to create. Example: Generate a 3-step outreach sequence for revenue leaders. Step 1 introduces the operational benefit, step 2 follows up with a concrete example, step 3 closes politely. Use placeholders like {{first_name}}, {{title}}, and {{company}}."
                            rows={6}
                            className="w-full px-3.5 py-3 border border-slate-200 bg-white rounded-xl text-xs leading-relaxed text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all resize-none"
                          />
                        </div>

                        {/* Steps and Delay settings side by side */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Drip Steps Count */}
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Sequence Length (Drip Steps Count)
                            </label>
                            <div className="flex gap-2">
                              {[1, 2, 3, 4].map((num) => (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={() => setWizardStepsCount(num)}
                                  className={`flex-1 py-2.5 text-center rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                    wizardStepsCount === num 
                                      ? 'bg-indigo-600 border-indigo-600 text-white' 
                                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  {num} {num === 1 ? 'Step' : 'Steps'}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Delay Selection */}
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Follow-up Interval (Delay Between Steps)
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                required
                                min={1}
                                value={wizardDelayAmount}
                                onChange={(e) => setWizardDelayAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className="w-20 px-3 py-2 border border-slate-200 bg-white rounded-xl text-xs font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500"
                              />
                              <select
                                value={wizardDelayUnit}
                                onChange={(e) => setWizardDelayUnit(e.target.value as any)}
                                className="flex-1 px-3 py-2 border border-slate-200 bg-white rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500"
                              >
                                <option value="minutes">Minutes</option>
                                <option value="hours">Hours</option>
                                <option value="days">Days</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4 pt-1">
                        {/* Manual steps settings */}
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Drip Steps Count
                          </label>
                          <div className="flex gap-2">
                            {[1, 2, 3].map((num) => (
                              <button
                                key={num}
                                type="button"
                                onClick={() => handleWizardStepsCountChange(num)}
                                className={`flex-1 py-2.5 text-center rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                  wizardStepsCount === num 
                                    ? 'bg-indigo-600 border-indigo-600 text-white' 
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                {num} {num === 1 ? 'Step' : 'Steps'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Prompts list */}
                        <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                          {wizardSteps.map((step, idx) => {
                            const delayFields = getDelayFields(step.delayMinutes);
                            return (
                              <div key={idx} className="p-3.5 border border-slate-200 bg-slate-50/40 rounded-xl space-y-3">
                                <span className="inline-flex items-center px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 font-mono text-[9px] font-bold rounded-md">
                                  STEP {step.order}
                                </span>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <div className="sm:col-span-2 space-y-1">
                                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Subject Template</label>
                                    <input
                                      type="text"
                                      required
                                      value={step.subjectTemplate}
                                      onChange={(e) => {
                                        const updated = [...wizardSteps];
                                        updated[idx].subjectTemplate = e.target.value;
                                        setWizardSteps(updated);
                                      }}
                                      className="w-full px-2.5 py-1.5 border border-slate-200 bg-white rounded-lg text-xs font-semibold"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Delay</label>
                                    <div className="flex gap-1.5">
                                      <input
                                        type="number"
                                        required
                                        min={1}
                                        value={delayFields.amount}
                                        onChange={(e) => {
                                          const amount = Math.max(1, parseInt(e.target.value, 10) || 1);
                                          const updated = [...wizardSteps];
                                          updated[idx].delayMinutes = getMinutesFromFields(amount, delayFields.unit);
                                          setWizardSteps(updated);
                                        }}
                                        className="w-14 px-1.5 py-1 border border-slate-200 bg-white rounded-lg text-xs font-mono font-bold text-center"
                                      />
                                      <select
                                        value={delayFields.unit}
                                        onChange={(e) => {
                                          const unit = e.target.value as any;
                                          const updated = [...wizardSteps];
                                          updated[idx].delayMinutes = getMinutesFromFields(delayFields.amount, unit);
                                          setWizardSteps(updated);
                                        }}
                                        className="flex-1 px-1 py-1 border border-slate-200 bg-white rounded-lg text-[10px] font-bold"
                                      >
                                        <option value="minutes">Mins</option>
                                        <option value="hours">Hours</option>
                                        <option value="days">Days</option>
                                      </select>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Email Body Template</label>
                                  <textarea
                                    required
                                    value={step.promptTemplate}
                                    onChange={(e) => {
                                      const updated = [...wizardSteps];
                                      updated[idx].promptTemplate = e.target.value;
                                      setWizardSteps(updated);
                                    }}
                                    rows={2.5}
                                    className="w-full px-2.5 py-1.5 border border-slate-200 bg-white rounded-lg text-xs leading-normal"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 5: Final review & generation trigger */}
                {wizardStep === 5 && (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step 5: Review & Trigger Generation</h4>
                      <p className="text-xs text-slate-500">Your campaign is ready to synthesize. Review the operational parameters below before launching.</p>
                    </div>

                    <div className="border border-slate-200 rounded-xl bg-slate-50/20 p-5 space-y-4 pt-4 shadow-inner">
                      <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs">
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Sequence Name</span>
                          <span className="font-bold text-slate-800">{wizardName}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Campaign Type</span>
                          <span className="font-bold text-slate-800 capitalize">{wizardOutreachType} Outreach</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Build Mode</span>
                          <span className="font-bold text-indigo-600">{wizardMode === 'auto' ? 'Auto-Generate with AI' : 'Manually Create Steps'}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Linguistic Tone</span>
                          <span className="font-bold text-slate-800">{wizardTone} Tone</span>
                        </div>
                        {wizardMode === 'auto' ? (
                          <>
                            <div className="col-span-2">
                              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">AI Sequence Generation Prompt</span>
                              <p className="whitespace-pre-wrap break-words font-medium text-slate-600 bg-slate-50 p-3 rounded border border-slate-100 mt-1">{wizardSinglePrompt}</p>
                            </div>
                            <div>
                              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Drip Steps Length</span>
                              <span className="font-bold text-slate-800">{wizardStepsCount} Steps</span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Delay Interval</span>
                              <span className="font-bold text-slate-800">{wizardDelayAmount} {wizardDelayUnit}</span>
                            </div>
                          </>
                        ) : (
                          <div>
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Drip Steps Length</span>
                            <span className="font-bold text-slate-800">{wizardStepsCount} Sequence Steps</span>
                          </div>
                        )}
                        <div className="col-span-2 border-t border-slate-150 pt-3">
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Target Audience Summary</span>
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            {wizardSelectedGroupIds.length > 0 && (
                              <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 rounded-md font-semibold text-indigo-700">
                                {wizardSelectedGroupIds.length} Segments Selected
                              </span>
                            )}
                            {wizardSelectedContactIds.length > 0 && (
                              <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md font-semibold text-slate-600">
                                {wizardSelectedContactIds.length} Direct Contacts
                              </span>
                            )}
                            {wizardRawImportText.trim() && (
                              <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-100 rounded-md font-semibold text-emerald-700">
                                Quick-import List Added
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-center py-4">
                      <p className="text-[11px] text-slate-400 italic">
                        Clicking the button below generates a draft sequence and opens it for review before launch.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Wizard Footer (Actions navigation) */}
              <div className="px-6 py-4.5 border-t border-slate-150 flex justify-between items-center bg-slate-50/50">
                <button
                  type="button"
                  disabled={wizardStep === 1 || wizardGenerating}
                  onClick={() => {
                    const nextStep = Math.max(wizardStep - 1, 1);
                    setWizardStep(nextStep);
                    updateCampaignsUrl({ wizard: true, step: nextStep });
                  }}
                  className="inline-flex items-center px-4 py-2 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Back
                </button>

                {wizardStep < 5 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setWizardError(null);
                      // Validation per step
                      if (wizardStep === 2 && wizardSelectedGroupIds.length === 0 && wizardSelectedContactIds.length === 0 && !wizardRawImportText.trim()) {
                        setWizardError('Please select at least one target audience source or copy-paste some custom contacts.');
                        return;
                      }
                      if (wizardStep === 3 && !wizardName.trim()) {
                        setWizardError('Campaign sequence name is required.');
                        return;
                      }
                      if (wizardStep === 4 && wizardMode === 'auto' && !wizardSinglePrompt.trim()) {
                        setWizardError('AI sequence generation prompt is required.');
                        return;
                      }
                      const nextStep = Math.min(wizardStep + 1, 5);
                      setWizardStep(nextStep);
                      updateCampaignsUrl({ wizard: true, step: nextStep });
                    }}
                    className="inline-flex items-center px-4.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-100 transition-all cursor-pointer"
                  >
                    Next Step
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={wizardGenerating}
                    onClick={handleWizardCreate}
                    className="inline-flex items-center px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold rounded-xl shadow-md shadow-indigo-100 transition-all cursor-pointer active:scale-95 disabled:opacity-60"
                  >
                    {wizardGenerating ? (
                      <>
                        <Loader2 className="animate-spin h-4 w-4 mr-2" />
                        Generating sequence...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2 text-indigo-200" />
                        Generate Sequence
                      </>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Shell>
  );
}
