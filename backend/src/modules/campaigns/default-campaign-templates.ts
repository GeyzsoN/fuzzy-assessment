export const DEFAULT_PROMPT_TEMPLATES = [
  {
    key: 'sequence-draft-v1',
    name: 'Sequence Draft Generator',
    purpose:
      'Generate placeholder-based outreach email body templates from a base template.',
    systemPrompt:
      'You generate safe outbound campaign sequence drafts. Never invent real people, emails, phone numbers, or company names. The promptTemplate field must be the exact email body to send, not instructions for another model. Preserve placeholders exactly, such as {{first_name}}, {{name}}, {{company}}, and {{title}}.',
    userPrompt:
      [
        'Create a draft outreach sequence as strict JSON only.',
        'Return this shape: {"steps":[{"order":1,"delayDays":0,"subjectTemplate":"...","promptTemplate":"..."}]}.',
        'Return exactly {{maxSteps}} steps.',
        'Use day-based delays.',
        'Every promptTemplate must be an actual email body ready to send after placeholder hydration.',
        'Every promptTemplate must include at least one contact placeholder: first_name, name, company, or title using double-curly placeholder syntax.',
        'Do not write meta-instructions like "Write an email" or "Draft a note" inside promptTemplate.',
        'Do not include real personal data. Keep placeholders unchanged.',
        '',
        'Campaign goal: {{goal}}',
        'Audience description: {{audienceDescription}}',
        'Tone: {{tone}}',
        'Base sequence skeleton JSON: {{baseStepsJson}}',
      ].join('\n'),
  },
];

export const DEFAULT_CAMPAIGN_TEMPLATES = [
  {
    key: 'cold-intro',
    name: 'Cold Intro Sequence',
    description:
      'A direct first-touch sequence for introducing a product or service.',
    defaultMaxSteps: 4,
    promptTemplateKey: 'sequence-draft-v1',
    steps: [
      {
        order: 1,
        delayDays: 0,
        subjectTemplate: 'Idea for {{company}}',
        promptTemplate:
          'Hi {{first_name}},\n\nI noticed your work as {{title}} at {{company}} and thought there may be a practical way to streamline the operational sequences your team handles every week.\n\nWorth a quick look?',
      },
      {
        order: 2,
        delayDays: 3,
        subjectTemplate: 'Following up on {{company}}',
        promptTemplate:
          'Hi {{first_name}},\n\nFollowing up on my note about {{company}}. The main reason I reached out is that teams often lose time coordinating repeatable outreach and workflow steps manually.\n\nOpen to a short conversation?',
      },
      {
        order: 3,
        delayDays: 7,
        subjectTemplate: 'Worth closing the loop?',
        promptTemplate:
          'Hi {{first_name}},\n\nI do not want to crowd your inbox. If improving sequence automation is not a priority for {{company}} right now, no worries.\n\nShould I close the loop?',
      },
      {
        order: 4,
        delayDays: 14,
        subjectTemplate: 'Final note for now',
        promptTemplate:
          'Hi {{first_name}},\n\nFinal note from me for now. If {{company}} revisits automation around repeatable workflows later, I would be glad to compare notes.\n\nThanks for considering it.',
      },
    ],
  },
  {
    key: 'warm-follow-up',
    name: 'Warm Follow-Up Sequence',
    description:
      'A softer sequence for people who already know you or your company.',
    defaultMaxSteps: 4,
    promptTemplateKey: 'sequence-draft-v1',
    steps: [
      {
        order: 1,
        delayDays: 0,
        subjectTemplate: 'Good to reconnect, {{name}}',
        promptTemplate:
          'Hi {{first_name}},\n\nGood to reconnect. I wanted to follow up with something that may be useful for {{company}} if your team is still looking at ways to reduce manual workflow coordination.\n\nWould it be useful to compare notes?',
      },
      {
        order: 2,
        delayDays: 4,
        subjectTemplate: 'Quick follow-up',
        promptTemplate:
          'Hi {{first_name}},\n\nQuick follow-up. If this is relevant, I can send over a short example of how teams use this to tighten repetitive outreach and operations steps.\n\nShould I send it?',
      },
      {
        order: 3,
        delayDays: 10,
        subjectTemplate: 'Last note for now',
        promptTemplate:
          'Hi {{first_name}},\n\nI will pause here. If workflow automation becomes more relevant for {{company}} later, I would be happy to reconnect.\n\nAppreciate your time.',
      },
      {
        order: 4,
        delayDays: 21,
        subjectTemplate: 'Staying in touch',
        promptTemplate:
          'Hi {{first_name}},\n\nCircling back lightly in case timing has changed at {{company}}. If not, no pressure at all.\n\nWould a brief check-in later this month make sense?',
      },
    ],
  },
  {
    key: 'event-networking',
    name: 'Event Networking Sequence',
    description:
      'A lightweight post-event sequence for starting conversations.',
    defaultMaxSteps: 4,
    promptTemplateKey: 'sequence-draft-v1',
    steps: [
      {
        order: 1,
        delayDays: 1,
        subjectTemplate: 'Great crossing paths',
        promptTemplate:
          'Hi {{first_name}},\n\nGreat crossing paths recently. Given your role as {{title}} at {{company}}, I thought it could be useful to compare notes on how teams are handling repeatable workflows and outreach sequences.\n\nOpen to staying in touch?',
      },
      {
        order: 2,
        delayDays: 5,
        subjectTemplate: 'Continuing the conversation',
        promptTemplate:
          'Hi {{first_name}},\n\nFollowing up in case a quick conversation would be useful. I can share a concise example of how similar teams simplify sequence-heavy workflows.\n\nWould next week work?',
      },
      {
        order: 3,
        delayDays: 9,
        subjectTemplate: 'One more event follow-up',
        promptTemplate:
          'Hi {{first_name}},\n\nOne more follow-up. If {{company}} is exploring better ways to coordinate repeated operational steps, I think there may be a useful angle to discuss.\n\nWorth a quick sync?',
      },
      {
        order: 4,
        delayDays: 16,
        subjectTemplate: 'Closing the loop',
        promptTemplate:
          'Hi {{first_name}},\n\nI will close the loop for now. If it becomes useful to compare notes on workflow automation or outreach sequencing, I would be glad to reconnect.\n\nThanks again.',
      },
    ],
  },
];
