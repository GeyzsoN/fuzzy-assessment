'use client';

import React, { useEffect, useRef } from 'react';
import { Bold, Italic, Link2, List, ListOrdered, Type } from 'lucide-react';

type TemplateRichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const PLACEHOLDERS = ['{{first_name}}', '{{company}}', '{{title}}'];

export function TemplateRichTextEditor({
  value,
  onChange,
  disabled = false,
}: TemplateRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.innerHTML === value) return;
    editor.innerHTML = templateToPreviewHtml(value);
  }, [value]);

  const syncValue = () => {
    const next = sanitizeTemplateHtml(editorRef.current?.innerHTML || '');
    onChange(next);
  };

  const runCommand = (command: string, commandValue?: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncValue();
  };

  const insertPlaceholder = (placeholder: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand('insertText', false, placeholder);
    syncValue();
  };

  const addLink = () => {
    const href = window.prompt('Link URL');
    if (!href) return;
    runCommand('createLink', href);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2">
        <EditorButton label="Bold" disabled={disabled} onClick={() => runCommand('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </EditorButton>
        <EditorButton label="Italic" disabled={disabled} onClick={() => runCommand('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </EditorButton>
        <EditorButton
          label="Bulleted list"
          disabled={disabled}
          onClick={() => runCommand('insertUnorderedList')}
        >
          <List className="h-3.5 w-3.5" />
        </EditorButton>
        <EditorButton
          label="Numbered list"
          disabled={disabled}
          onClick={() => runCommand('insertOrderedList')}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </EditorButton>
        <EditorButton label="Link" disabled={disabled} onClick={addLink}>
          <Link2 className="h-3.5 w-3.5" />
        </EditorButton>
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline-block" />
        {PLACEHOLDERS.map((placeholder) => (
          <button
            key={placeholder}
            type="button"
            title={`Insert ${placeholder}`}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insertPlaceholder(placeholder)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-bold text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {placeholder}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={syncValue}
        onBlur={syncValue}
        className="min-h-44 rounded-b-xl px-4 py-3 text-sm leading-7 text-slate-700 outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 [&_a]:text-indigo-600 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
      />
    </div>
  );
}

function EditorButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function TemplateBodyPreview({ value }: { value: string }) {
  return (
    <div
      className="break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-700 [&_a]:text-indigo-600 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-6"
      dangerouslySetInnerHTML={{ __html: templateToPreviewHtml(value) }}
    />
  );
}

export function templateToPreviewHtml(value: string) {
  const source = value || '';
  if (/<[a-z][\s\S]*>/i.test(source)) {
    return sanitizeTemplateHtml(source);
  }
  return escapeHtml(source).replace(/\n/g, '<br />');
}

function sanitizeTemplateHtml(value: string) {
  if (typeof window === 'undefined') {
    return value || '';
  }

  const template = document.createElement('template');
  template.innerHTML = value || '';
  const allowedTags = new Set([
    'A',
    'B',
    'BR',
    'DIV',
    'EM',
    'I',
    'LI',
    'OL',
    'P',
    'SPAN',
    'STRONG',
    'U',
    'UL',
  ]);
  const allowedAttrs = new Set(['href', 'target', 'rel']);
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_ELEMENT,
  );
  const remove: Element[] = [];

  while (walker.nextNode()) {
    const element = walker.currentNode as Element;
    if (!allowedTags.has(element.tagName)) {
      remove.push(element);
      continue;
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name) || name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' && /^javascript:/i.test(attr.value.trim())) {
        element.removeAttribute(attr.name);
      }
    }
    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer');
    }
  }

  remove.forEach((element) => {
    element.replaceWith(document.createTextNode(element.textContent || ''));
  });

  return template.innerHTML.trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
