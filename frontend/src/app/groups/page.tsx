'use client';

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw, Plus, Users, Loader2, AlertCircle, Trash2, UserPlus, FileText } from 'lucide-react';
import Shell from '@/components/shell';
import { groupsService, contactsService, Group, GroupDetail, Contact } from '@/services/api';

export default function GroupsPage() {
  return (
    <Suspense fallback={<Shell><div className="text-sm text-slate-500">Loading groups...</div></Shell>}>
      <GroupsPageContent />
    </Suspense>
  );
}

function GroupsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const selectedGroupParam = searchParams.get('group');

  // Lists
  const [groups, setGroups] = useState<Group[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  
  // Selection & Details
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupDetail, setSelectedGroupDetail] = useState<GroupDetail | null>(null);

  // Load States
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  // Group creation form
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Add contact to group form
  const [selectedContactId, setSelectedContactId] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  const [addContactError, setAddContactError] = useState<string | null>(null);

  const updateGroupUrl = useCallback(
    (groupId: string | null, mode: 'push' | 'replace' = 'push') => {
      const params = new URLSearchParams(searchParams.toString());
      if (groupId) {
        params.set('group', groupId);
      } else {
        params.delete('group');
      }

      const nextUrl = params.toString() ? `/groups?${params.toString()}` : '/groups';
      router[mode](nextUrl, { scroll: false });
    },
    [router, searchParams],
  );

  // Load Groups and Contacts
  const loadInitialData = useCallback(async () => {
    setLoadingGroups(true);
    setLoadError(null);
    try {
      const groupsData = await groupsService.getAll();
      setGroups(groupsData);

      // Fetch all active contacts for the dropdown (limit 100 for simplicity)
      const contactsData = await contactsService.getAll('', 1, 100);
      setAllContacts(contactsData.contacts);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load groups data.');
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (loadingGroups) return;

    if (groups.length === 0) {
      if (selectedGroupId) {
        setSelectedGroupId(null);
      }
      if (selectedGroupParam) {
        updateGroupUrl(null, 'replace');
      }
      return;
    }

    const urlGroupIsValid =
      Boolean(selectedGroupParam) &&
      groups.some((group) => group.id === selectedGroupParam);
    const nextGroupId = urlGroupIsValid ? selectedGroupParam! : groups[0].id;

    if (selectedGroupId !== nextGroupId) {
      setSelectedGroupId(nextGroupId);
    }
    if (selectedGroupParam !== nextGroupId) {
      updateGroupUrl(nextGroupId, 'replace');
    }
  }, [
    groups,
    loadingGroups,
    queryString,
    selectedGroupId,
    selectedGroupParam,
    updateGroupUrl,
  ]);

  // Load Group Details when ID changes
  const loadGroupDetails = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setAddContactError(null);
    try {
      const detail = await groupsService.getById(id);
      setSelectedGroupDetail(detail);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load group details.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedGroupId) {
      loadGroupDetails(selectedGroupId);
    } else {
      setSelectedGroupDetail(null);
    }
  }, [selectedGroupId, loadGroupDetails]);

  // Create Group Handler
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!newGroupName.trim()) {
      setCreateError('Group name is required.');
      return;
    }

    setCreatingGroup(true);
    try {
      const newGroup = await groupsService.create({
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
      });

      setNewGroupName('');
      setNewGroupDesc('');
      
      // Reload groups and select the newly created one
      const groupsData = await groupsService.getAll();
      setGroups(groupsData);
      setSelectedGroupId(newGroup.id);
      updateGroupUrl(newGroup.id);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create group.');
    } finally {
      setCreatingGroup(false);
    }
  };

  // Add Member Handler
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddContactError(null);

    if (!selectedGroupId || !selectedContactId) {
      setAddContactError('Please select a contact to add.');
      return;
    }

    setAddingContact(true);
    try {
      await groupsService.addContact(selectedGroupId, selectedContactId);
      setSelectedContactId('');
      
      // Reload details and groups (to update counts)
      await loadGroupDetails(selectedGroupId);
      const groupsData = await groupsService.getAll();
      setGroups(groupsData);
    } catch (err: any) {
      setAddContactError(err.message || 'Failed to add contact.');
    } finally {
      setAddingContact(false);
    }
  };

  // Remove Member Handler
  const handleRemoveMember = async (contactId: string) => {
    if (!selectedGroupId) return;

    try {
      await groupsService.removeContact(selectedGroupId, contactId);
      
      // Reload details and groups (to update counts)
      await loadGroupDetails(selectedGroupId);
      const groupsData = await groupsService.getAll();
      setGroups(groupsData);
    } catch (err: any) {
      setAddContactError(err.message || 'Failed to remove contact.');
    }
  };

  return (
    <Shell>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-5 mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-sans font-semibold tracking-tight text-slate-950">
            Contact Groups
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Segment your contacts to target precise niches with tailored multi-step sequences
          </p>
        </div>
        <button
          onClick={loadInitialData}
          disabled={loadingGroups}
          className="inline-flex items-center px-3.5 py-2 border border-slate-200 text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 transition-colors shadow-sm cursor-pointer"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loadingGroups ? 'animate-spin' : ''}`} />
          Refresh Groups
        </button>
      </div>

      {/* Main Grid: Create Group Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Left Column: Create Group Block */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sticky top-24 shadow-sm">
            <h2 className="text-sm font-sans font-bold text-slate-900 mb-5 uppercase tracking-wider">
              Create New Group
            </h2>

            {createError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium flex items-start">
                <AlertCircle className="h-4 w-4 mr-1.5 shrink-0 mt-0.5 text-red-500" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Group Name *
                </label>
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Creative Directors"
                  className="w-full px-3 py-2 border border-slate-200 bg-slate-50/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Description
                </label>
                <textarea
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="Target segment for outbound design tool pitch..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 bg-slate-50/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={creatingGroup}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
              >
                {creatingGroup ? (
                  <>
                    <Loader2 className="animate-spin h-3.5 w-3.5 mr-2" />
                    Creating Group...
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 mr-2" />
                    Create Group
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Columns: Main Two-Column Management Area */}
        <div className="lg:col-span-3">
          {loadError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center">
              <AlertCircle className="h-5 w-5 mr-2 text-red-500" />
              <span>{loadError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
            
            {/* Split Left: Groups list / table (2/5 columns) */}
            <div className="md:col-span-2 space-y-4">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                Your Segments
              </span>
              
              {loadingGroups ? (
                <div className="p-12 border border-slate-200 bg-white rounded-2xl flex justify-center items-center shadow-sm">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                </div>
              ) : groups.length === 0 ? (
                <div className="p-8 border border-slate-200 bg-slate-50 rounded-2xl text-center text-slate-400 text-sm">
                  No groups created yet.
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-slate-150">
                  {groups.map((group) => {
                    const active = group.id === selectedGroupId;
                    return (
                      <button
                        key={group.id}
                        onClick={() => {
                          setSelectedGroupId(group.id);
                          updateGroupUrl(group.id);
                        }}
                        className={`w-full text-left p-4 flex items-center justify-between transition-all cursor-pointer ${
                          active
                            ? 'bg-indigo-50/40 border-l-4 border-l-indigo-600 pl-3 font-semibold'
                            : 'hover:bg-slate-50/50 border-l-4 border-l-transparent'
                        }`}
                      >
                        <div className="pr-4">
                          <div className={`text-sm ${active ? 'text-indigo-950 font-extrabold' : 'text-slate-800'}`}>
                            {group.name}
                          </div>
                          {group.description && (
                            <div className="text-xs text-slate-400 font-normal line-clamp-1 mt-1">
                              {group.description}
                            </div>
                          )}
                        </div>
                        <div className={`inline-flex items-center space-x-1.5 px-2.5 py-1 border rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${
                          active
                            ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                        }`}>
                          <Users className="h-3 w-3" />
                          <span>{group.memberCount}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Split Right: Selected Group detail (3/5 columns) */}
            <div className="md:col-span-3">
              {loadingDetail ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-400 bg-white border border-slate-200 rounded-2xl shadow-sm">
                  <Loader2 className="h-8 w-8 animate-spin mb-2 text-indigo-500" />
                  <span className="text-xs font-semibold text-slate-500">Loading segment details...</span>
                </div>
              ) : selectedGroupDetail ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
                  
                  {/* Title & Description Header */}
                  <div>
                    <div className="flex justify-between items-start gap-4">
                      <h2 className="text-lg font-sans font-bold text-slate-900 tracking-tight">
                        {selectedGroupDetail.name}
                      </h2>
                      <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-indigo-100 shadow-sm">
                        <Users className="h-3 w-3 mr-1" />
                        {selectedGroupDetail.members.length} members
                      </span>
                    </div>
                    {selectedGroupDetail.description ? (
                      <p className="mt-3 text-sm text-slate-600 leading-relaxed bg-slate-50/50 p-4 rounded-xl border border-slate-200/60">
                        {selectedGroupDetail.description}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400 italic">No description provided for this group.</p>
                    )}
                  </div>

                  {/* Add contact to group section */}
                  <div className="border-t border-slate-200 pt-5">
                    <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Add Contact to Segment
                    </span>

                    {addContactError && (
                      <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
                        {addContactError}
                      </div>
                    )}

                    <form onSubmit={handleAddMember} className="flex gap-2.5">
                      <select
                        value={selectedContactId}
                        onChange={(e) => setSelectedContactId(e.target.value)}
                        className="flex-1 px-3 py-2 border border-slate-200 bg-slate-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                      >
                        <option value="">-- Choose a contact --</option>
                        {allContacts
                          .filter(c => !selectedGroupDetail.contactIds.includes(c.id))
                          .map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.email}) {c.company ? `— ${c.company}` : ''}
                            </option>
                          ))
                        }
                      </select>
                      <button
                        type="submit"
                        disabled={addingContact || !selectedContactId}
                        className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer shrink-0"
                      >
                        {addingContact ? (
                          <Loader2 className="animate-spin h-3.5 w-3.5" />
                        ) : (
                          <>
                            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                            Add
                          </>
                        )}
                      </button>
                    </form>
                  </div>

                  {/* Group members table */}
                  <div className="border-t border-slate-200 pt-5">
                    <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Current Segment Members
                    </span>

                    {selectedGroupDetail.members.length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                        This group is empty. Add contacts using the form above to build your segment.
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-55 border-b border-slate-200 font-bold uppercase tracking-wider text-slate-400">
                              <th className="px-4 py-3">Name</th>
                              <th className="px-4 py-3">Email</th>
                              <th className="px-4 py-3">Company</th>
                              <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-150 text-slate-700">
                            {selectedGroupDetail.members.map((member) => (
                              <tr key={member.id} className="hover:bg-indigo-50/10 transition-colors">
                                <td className="px-4 py-3 font-semibold text-slate-900">
                                  {member.name}
                                </td>
                                <td className="px-4 py-3 font-mono text-slate-500">
                                  {member.email}
                                </td>
                                <td className="px-4 py-3 text-slate-500">
                                  {member.company ? (
                                    <span className="px-2 py-0.5 bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold border border-slate-200/60">
                                      {member.company}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    onClick={() => handleRemoveMember(member.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors cursor-pointer rounded-lg hover:bg-red-50"
                                    title="Remove from Group"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                </div>
              ) : (
                <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl text-slate-400 text-sm shadow-sm">
                  Select a segment group from the left to manage memberships.
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </Shell>
  );
}
