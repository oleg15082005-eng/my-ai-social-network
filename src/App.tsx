import React, { useState, useEffect, useRef } from 'react';
import { Home, Globe, MessageSquare, Plus, Send, Heart, UserPlus, UserCheck, Bot, User as UserIcon, RefreshCw, Loader } from 'lucide-react';
import { motion } from 'motion/react';

// --- TYPES ---
export type User = { id: string; name: string; isAi: boolean; age?: number; goals?: string; bio?: string; subscriptions?: string[]; };
export type Post = { id: string; authorId: string; type: 'text' | 'photo'; content: string; likes: string[]; createdAt: number; };
export type Comment = { id: string; postId: string; authorId: string; content: string; createdAt: number; };
export type DM = { id: string; senderId: string; receiverId: string; message: string; contextTrigger?: string; createdAt: number; };

type PopulatedPost = Post & { author: User; comments: (Comment & { author: User })[] };

const generateId = () => Math.random().toString(36).substring(2, 10);
const HUMAN_ID = 'human-1';

// --- GLOBAL STATE / DB ---
export const db = {
  users: [
    { id: HUMAN_ID, name: 'AlexHuman', isAi: false, subscriptions: [] }
  ] as User[],
  posts: [] as Post[],
  comments: [] as Comment[],
  dms: [] as DM[],
  listeners: new Set<() => void>(),
  
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { this.listeners.forEach(fn => fn()); },
  
  getUser(id: string) { return this.users.find(u => u.id === id); },
  
  getPopulatedPosts(): PopulatedPost[] {
    return this.posts.map(post => ({
      ...post,
      author: this.getUser(post.authorId)!,
      comments: this.comments.filter(c => c.postId === post.id).map(c => ({...c, author: this.getUser(c.authorId)!})).sort((a,b) => a.createdAt - b.createdAt)
    })).sort((a,b) => b.createdAt - a.createdAt);
  }
};

function useDB() {
  const [tick, setTick] = useState(0);
  useEffect(() => db.subscribe(() => setTick(t => t + 1)), []);
  return db;
}

// --- LOCAL AI ENGINE ---
const LOCAL_AI_URL = 'http://127.0.0.1:1337/v1/chat/completions';

async function callLocalAI(system: string, user: string) {
  const res = await fetch(LOCAL_AI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "L3-8B-Stheno-v3.2-Q4_K_M-imat", // local model or omit
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7
    })
  });
  if (!res.ok) throw new Error(`Local AI API Error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

function extractJSON(text: string) {
   const start = text.indexOf('[');
   const objStart = text.indexOf('{');
   if (start === -1 && objStart === -1) return JSON.parse(text);
   const first = (start !== -1 && (start < objStart || objStart === -1)) ? start : objStart;
   const last = first === start ? text.lastIndexOf(']') : text.lastIndexOf('}');
   return JSON.parse(text.substring(first, last + 1));
}

// --- ACTIONS ---
async function handleDiscover() {
   const prompt = `Generate exactly 5 unique, distinct, completely original female AI profiles for a social network.
They must have diverse personalities, ages (18-50), goals, and rich "About Me" bios.
Respond ONLY with a valid JSON array of objects. No markdown formatting blocks.
[
  { "name": "First Last", "age": 25, "goals": "short goals", "bio": "detailed bio" }
]`;
   const text = await callLocalAI("You are a creative persona generator. Output ONLY JSON.", prompt);
   const profiles = extractJSON(text);
   const newBots = profiles.map((p: any) => ({
     id: generateId(), name: p.name || 'Unknown', isAi: true, age: p.age || 25, goals: p.goals || '', bio: p.bio || ''
   }));
   db.users.push(...newBots);
   db.emit();
   return newBots;
}

async function triggerLiveActivity(post: Post) {
  const human = db.getUser(HUMAN_ID)!;
  const bots = (human.subscriptions || []).map(id => db.getUser(id)).filter(Boolean) as User[];
  if (bots.length === 0) return;
  
  const botsChunk = bots.slice(0, 3);
  const prompt = `You are simulating ${botsChunk.length} distinct AI users who follow ${human.name}.
${human.name} just posted: "${post.content}"

AI profiles:
${botsChunk.map(b => `ID: ${b.id} | Name: ${b.name} | Bio: ${b.bio}`).join('\n\n')}

For EACH AI, decide if they like the post, comment, or send a DM.
Respond ONLY with a valid JSON array:
[
  { "botId": "string", "like": boolean, "comment": "string or null", "dm": "string or null" }
]`;
  try {
    const text = await callLocalAI("You simulate social media users. Output ONLY JSON.", prompt);
    const results = extractJSON(text);
    results.forEach((res: any) => {
       if (res.like && !post.likes.includes(res.botId)) post.likes.push(res.botId);
       if (res.comment) db.comments.push({ id: generateId(), postId: post.id, authorId: res.botId, content: res.comment, createdAt: Date.now() });
       if (res.dm) db.dms.push({ id: generateId(), senderId: res.botId, receiverId: HUMAN_ID, message: res.dm, contextTrigger: `Your post: ${post.content}`, createdAt: Date.now() });
    });
    db.emit();
  } catch (e) { console.error('Activity error', e); }
}

async function triggerAiChatReaction(dm: DM) {
  const bot = db.getUser(dm.receiverId)!;
  const human = db.getUser(HUMAN_ID)!;
  const history = db.dms.filter(d => (d.senderId === HUMAN_ID && d.receiverId === bot.id) || (d.senderId === bot.id && d.receiverId === HUMAN_ID)).sort((a,b) => a.createdAt - b.createdAt).slice(-10);
  const historyText = history.map(d => `${d.senderId === HUMAN_ID ? human.name : bot.name}: ${d.message}`).join('\n');
  
  const prompt = `You are ${bot.name} chatting with ${human.name}.
Your Bio: ${bot.bio}

${dm.contextTrigger ? `Context: ${dm.contextTrigger}` : ''}

Chat History:
${historyText}

Write your next message. ONLY valid JSON: { "message": "your text" }`;
  
  try {
    const text = await callLocalAI("You are a roleplay conversationalist. Output ONLY JSON.", prompt);
    const res = extractJSON(text);
    if (res.message) {
      db.dms.push({ id: generateId(), senderId: bot.id, receiverId: HUMAN_ID, message: res.message, createdAt: Date.now() });
      db.emit();
    }
  } catch (e) { console.error('Chat error', e); }
}

async function simulateBotNetworkActivity() {
  const human = db.getUser(HUMAN_ID)!;
  const bots = (human.subscriptions || []).map(id => db.getUser(id)).filter(Boolean) as User[];
  if (bots.length === 0) return;
  const bot = bots[Math.floor(Math.random() * bots.length)];
  
  const prompt = `You are ${bot.name}. Bio: ${bot.bio}. Goals: ${bot.goals}.
Write a short new status update post for your social media feed. Keep it in character.
ONLY valid JSON: { "content": "your post text" }`;
  
  try {
    const text = await callLocalAI("You are a roleplay conversationalist. Output ONLY JSON.", prompt);
    const res = extractJSON(text);
    if (res.content) {
      db.posts.push({ id: generateId(), authorId: bot.id, type: 'text', content: res.content, likes: [], createdAt: Date.now() });
      db.emit();
    }
  } catch (e) { console.error('Simulate post error', e); }
}

// --- MAIN APP COMPONENT ---
export default function App() {
  const [activeTab, setActiveTab] = useState<'feed' | 'discover' | 'chat' | 'profile'>('discover');
  const database = useDB();
  const me = database.getUser(HUMAN_ID)!;
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [initialChatContext, setInitialChatContext] = useState<string>('');

  const openChat = (botId: string, context?: string) => {
    setSelectedBotId(botId);
    if (context) setInitialChatContext(context);
    setActiveTab('chat');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col md:flex-row">
      {/* Global Navigation */}
      <nav className="w-full md:w-24 lg:w-64 bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-800 p-4 flex md:flex-col items-center lg:items-start gap-8 justify-between md:justify-start">
        <div className="flex items-center gap-3 hidden md:flex w-full">
          <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center font-bold text-lg flex-shrink-0">N</div>
          <h1 className="text-xl font-bold tracking-tight hidden lg:block">NeuralNet</h1>
        </div>
        
        <div className="flex md:flex-col w-full gap-2 justify-around md:justify-start">
          <NavButton icon={<Globe size={24}/>} label="Discover" active={activeTab === 'discover'} onClick={() => setActiveTab('discover')} />
          <NavButton icon={<Home size={24}/>} label="Feed" active={activeTab === 'feed'} onClick={() => setActiveTab('feed')} />
          <NavButton icon={<MessageSquare size={24}/>} label="Messages" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
        </div>

        <button onClick={() => setActiveTab('profile')} className={`mt-auto hidden md:flex items-center gap-3 p-3 rounded-xl w-full text-left transition-colors ${activeTab === 'profile' ? 'bg-indigo-600/20 text-indigo-100' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}>
          <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center uppercase font-bold text-lg">{me.name[0]}</div>
          <div className="overflow-hidden hidden lg:block">
            <p className="font-medium truncate">{me.name}</p>
            <p className="text-xs text-zinc-400">View Profile</p>
          </div>
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 h-[calc(100vh-73px)] md:h-screen overflow-hidden relative">
        {activeTab === 'discover' && <DiscoverView me={me} />}
        {activeTab === 'feed' && <FeedView me={me} onOpenChat={openChat} />}
        {activeTab === 'chat' && <ChatView me={me} selectedBotId={selectedBotId} initialContext={initialChatContext} onClearContext={() => setInitialChatContext('')} />}
        {activeTab === 'profile' && <ProfileView me={me} onOpenChat={openChat} />}
      </main>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`p-3 lg:px-4 lg:py-3 rounded-xl flex items-center justify-center lg:justify-start gap-3 w-full transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}
      title={label}
    >
      {icon}
      <span className="hidden lg:block font-medium">{label}</span>
    </button>
  );
}

// --- DISCOVER VIEW ---
function DiscoverView({ me }: { me: User }) {
  const database = useDB();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aiProfiles = database.users.filter(u => u.isAi);

  const fetchMore = async () => {
    setLoading(true);
    setError(null);
    try {
      await handleDiscover();
    } catch (e: any) {
      setError(e.message || 'Failed to connect to Local AI. Is Jan running on port 1337?');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (aiProfiles.length === 0 && !loading) fetchMore();
  }, []);

  const handleSubscribe = (botId: string) => {
    if (!me.subscriptions) me.subscriptions = [];
    if (!me.subscriptions.includes(botId)) {
      me.subscriptions.push(botId);
      db.emit();
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 space-y-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
           <h2 className="text-3xl font-bold">Discover Personalities</h2>
           <button onClick={fetchMore} disabled={loading} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
             {loading ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />} 
             Generate More
           </button>
        </div>
        
        {loading && aiProfiles.length === 0 ? (
          <div className="flex justify-center py-20 text-zinc-500 gap-3 items-center">
             <Loader size={24} className="animate-spin" />
             Connecting to Local AI to generate distinct personas...
          </div>
        ) : error && aiProfiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-red-500 font-medium">{error}</p>
            <button onClick={fetchMore} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-200 transition-colors">Try Again</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {aiProfiles.map(p => {
              const isSubscribed = me.subscriptions?.includes(p.id);
              return (
                <motion.div key={p.id} initial={{opacity: 0, scale: 0.95}} animate={{opacity: 1, scale: 1}} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col hover:border-zinc-700 transition-colors">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-2xl font-bold text-zinc-100">{p.name}</h3>
                      <p className="text-zinc-400 text-sm">{p.age} years old</p>
                    </div>
                    <button 
                      onClick={() => handleSubscribe(p.id)}
                      disabled={isSubscribed}
                      className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${isSubscribed ? 'bg-zinc-800 text-zinc-500' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                    >
                      {isSubscribed ? <><UserCheck size={16}/> Subscribed</> : <><UserPlus size={16}/> Subscribe</>}
                    </button>
                  </div>
                  <div className="mb-4">
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">Main Goals</h4>
                    <p className="text-zinc-200 text-sm">{p.goals}</p>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">About Me</h4>
                    <p className="text-zinc-400 text-sm leading-relaxed">{p.bio}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// --- FEED VIEW ---
function FeedView({ me, onOpenChat }: { me: User, onOpenChat: (id: string, ctx?: string) => void }) {
  const database = useDB();
  const posts = database.getPopulatedPosts();
  const [newPost, setNewPost] = useState('');
  const [simulating, setSimulating] = useState(false);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPost.trim()) return;
    const post: Post = { id: generateId(), authorId: me.id, type: 'text', content: newPost, likes: [], createdAt: Date.now() };
    db.posts.push(post);
    db.emit();
    setNewPost('');
    
    // Trigger bots to react to this human post
    await triggerLiveActivity(post);
  };

  const handleLike = (id: string) => {
    const post = db.posts.find(p => p.id === id);
    if (post && !post.likes.includes(me.id)) {
      post.likes.push(me.id);
      db.emit();
    }
  };

  const runSimulate = async () => {
    setSimulating(true);
    await simulateBotNetworkActivity();
    setSimulating(false);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 bg-zinc-950">
      <div className="max-w-2xl mx-auto space-y-8 pb-24">
        
        <div className="flex justify-between items-center bg-indigo-900/20 border border-indigo-500/20 p-4 rounded-xl text-indigo-200">
           <p className="text-sm font-medium">Want to see posts from friends you subscribed to?</p>
           <button onClick={runSimulate} disabled={simulating || (me.subscriptions?.length === 0)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-2">
             {simulating ? <Loader size={16} className="animate-spin" /> : <Bot size={16} />}
             Simulate Friend Posts
           </button>
        </div>

        {/* Composer */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl">
          <form onSubmit={handlePost} className="space-y-4">
            <textarea
              placeholder="What's on your mind? (New posts trigger subscribed AI responses)"
              value={newPost}
              onChange={(e) => setNewPost(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none h-24"
            />
            <div className="flex justify-end">
              <button type="submit" disabled={!newPost.trim()} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                Post
              </button>
            </div>
          </form>
        </div>

        {/* Feed */}
        <div className="space-y-6">
          {posts.map(post => (
            <motion.div key={post.id} initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-lg">
               <div className="flex items-center gap-3 mb-4">
                 <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-lg uppercase">{post.author.name[0]}</div>
                 <div>
                   <div className="flex items-center gap-2">
                     <span className="font-bold">{post.author.name}</span>
                     {post.author.isAi && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">AI</span>}
                   </div>
                   <span className="text-xs text-zinc-500">{new Date(post.createdAt).toLocaleTimeString()}</span>
                 </div>
               </div>
               
               <div className="space-y-4 mb-4">
                 <p className="text-zinc-200 whitespace-pre-wrap">{post.content}</p>
               </div>

               <div className="flex items-center gap-6 pt-4 border-t border-zinc-800">
                 <button onClick={() => handleLike(post.id)} className={`flex items-center gap-2 text-sm font-medium transition-colors ${post.likes.includes(me.id) ? 'text-red-500' : 'text-zinc-400 hover:text-red-400'}`}>
                   <Heart size={18} className={post.likes.includes(me.id) ? 'fill-current' : ''} />
                   {post.likes.length > 0 && <span>{post.likes.length}</span>}
                 </button>
                 <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                   <MessageSquare size={18} />
                   {post.comments.length > 0 && <span>{post.comments.length}</span>}
                 </div>
               </div>

               {post.comments.length > 0 && (
                 <div className="mt-4 space-y-3 pt-4 border-t border-zinc-800">
                   {post.comments.map(comment => (
                     <div key={comment.id} className="flex gap-3">
                       <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center font-bold flex-shrink-0 text-sm uppercase">{comment.author.name[0]}</div>
                       <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3">
                         <div className="flex items-center justify-between mb-1">
                           <div className="flex items-center gap-2">
                             <span className="font-medium text-sm">{comment.author.name}</span>
                             {comment.author.isAi && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">AI</span>}
                           </div>
                           {comment.author.isAi && (
                             <button onClick={() => onOpenChat(comment.authorId, `You commented '${comment.content}' on a post.`)} className="text-indigo-400 hover:text-indigo-300 p-1 bg-indigo-500/10 hover:bg-indigo-500/20 rounded transition-colors" title="Brain Plus: Start DM">
                               <Plus size={14}/>
                             </button>
                           )}
                         </div>
                         <p className="text-sm text-zinc-300 whitespace-pre-wrap">{comment.content}</p>
                       </div>
                     </div>
                   ))}
                 </div>
               )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- CHAT VIEW ---
function ChatView({ me, selectedBotId, initialContext, onClearContext }: any) {
  const database = useDB();
  const [activeChatId, setActiveChatId] = useState<string | null>(selectedBotId);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const aiProfiles = database.users.filter(u => u.isAi);
  const conversations = aiProfiles.filter(u => 
    database.dms.some(d => d.senderId === u.id || d.receiverId === u.id) || me.subscriptions?.includes(u.id)
  );

  useEffect(() => { if (selectedBotId) setActiveChatId(selectedBotId); }, [selectedBotId]);

  const messages = activeChatId ? database.dms.filter(d => (d.senderId === me.id && d.receiverId === activeChatId) || (d.senderId === activeChatId && d.receiverId === me.id)).sort((a,b) => a.createdAt - b.createdAt) : [];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeChatId) return;

    const dm: DM = { id: generateId(), senderId: me.id, receiverId: activeChatId, message: newMessage, contextTrigger: initialContext || undefined, createdAt: Date.now() };
    db.dms.push(dm);
    db.emit();
    
    setNewMessage('');
    if (initialContext) onClearContext();

    await triggerAiChatReaction(dm);
  };

  const activeUser = conversations.find(u => u.id === activeChatId);

  return (
    <div className="h-full flex flex-col md:flex-row bg-zinc-950">
      {/* Sidebar */}
      <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col h-1/3 md:h-full overflow-hidden bg-zinc-900/50">
        <div className="p-4 border-b border-zinc-800"><h2 className="font-bold text-lg">Conversations</h2></div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && <div className="p-4 text-zinc-500 text-sm">No connections yet. Subscribe to someone on the Globe tab.</div>}
          {conversations.map(u => (
            <button key={u.id} onClick={() => setActiveChatId(u.id)} className={`w-full p-4 flex items-center gap-3 text-left transition-colors ${activeChatId === u.id ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}>
              <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center font-bold text-xl relative flex-shrink-0 uppercase">
                {u.name[0]}
                {u.isAi && <div className="absolute -bottom-1 -right-1 bg-indigo-600 rounded-full p-1 border-2 border-zinc-950"><Bot size={10} className="text-white"/></div>}
              </div>
              <div className="flex-1 overflow-hidden">
                <h3 className="font-medium truncate">{u.name}</h3>
                {u.isAi && <p className="text-xs text-zinc-500 truncate">{u.goals}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col h-2/3 md:h-full">
        {activeUser ? (
          <>
            <div className="p-4 border-b border-zinc-800 flex items-center gap-3 bg-zinc-950">
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-lg uppercase">{activeUser.name[0]}</div>
              <div>
                <h2 className="font-bold flex items-center gap-2">{activeUser.name} {activeUser.isAi && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">AI</span>}</h2>
              </div>
            </div>
            
            {initialContext && (
              <div className="bg-indigo-900/30 border-b border-indigo-500/20 p-3 flex items-start gap-2">
                <Bot size={16} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-indigo-200">Context ready: "{initialContext}"</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                 <div className="h-full flex items-center justify-center text-zinc-500 text-sm">No messages yet. Say hello!</div>
              ) : (
                messages.map(msg => {
                  const isMe = msg.senderId === me.id;
                  return (
                    <motion.div key={msg.id} initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${isMe ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-zinc-800 text-zinc-100 rounded-tl-sm'}`}>
                        <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
                      </div>
                    </motion.div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-zinc-950 border-t border-zinc-800">
              <form onSubmit={handleSend} className="flex gap-2">
                <input type="text" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder={`Message ${activeUser.name}...`} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <button type="submit" disabled={!newMessage.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white disabled:opacity-50"><Send size={18}/></button>
              </form>
            </div>
          </>
        ) : (
           <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-4"><MessageSquare size={48} /><p>Select a conversation</p></div>
        )}
      </div>
    </div>
  );
}

// --- PROFILE VIEW ---
function ProfileView({ me, onOpenChat }: { me: User, onOpenChat: (id: string, ctx?: string) => void }) {
  const database = useDB();
  const [tab, setTab] = useState<'posts'|'comments'|'likes'|'friends'>('posts');
  
  const myPosts = database.getPopulatedPosts().filter(p => p.authorId === me.id);
  const myComments = database.comments.filter(c => c.authorId === me.id).map(c => ({...c, post: database.posts.find(p => p.id === c.postId)}));
  const likedPosts = database.getPopulatedPosts().filter(p => p.likes.includes(me.id));
  const friends = (me.subscriptions || []).map(id => database.getUser(id)).filter(Boolean) as User[];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 space-y-8 bg-zinc-950">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 mb-8 flex items-center gap-6 shadow-xl">
           <div className="w-24 h-24 rounded-full bg-zinc-700 flex items-center justify-center font-bold text-4xl uppercase text-zinc-300">
             {me.name[0]}
           </div>
           <div>
             <h2 className="text-3xl font-bold text-zinc-100">{me.name}</h2>
             <p className="text-zinc-400 mt-1">Human Account • {friends.length} Connections</p>
           </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-zinc-800 mb-8 overflow-x-auto pb-2">
           <button onClick={()=>setTab('posts')} className={`px-4 py-2 font-medium whitespace-nowrap transition-colors ${tab === 'posts' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}>My Posts ({myPosts.length})</button>
           <button onClick={()=>setTab('comments')} className={`px-4 py-2 font-medium whitespace-nowrap transition-colors ${tab === 'comments' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}>My Comments ({myComments.length})</button>
           <button onClick={()=>setTab('likes')} className={`px-4 py-2 font-medium whitespace-nowrap transition-colors ${tab === 'likes' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}>Liked Posts ({likedPosts.length})</button>
           <button onClick={()=>setTab('friends')} className={`px-4 py-2 font-medium whitespace-nowrap transition-colors ${tab === 'friends' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}>Friends ({friends.length})</button>
        </div>

        {/* Tab Content */}
        <div className="space-y-6 pb-24">
           {tab === 'posts' && myPosts.map(post => (
             <div key={post.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-lg">
               <p className="text-zinc-200 whitespace-pre-wrap">{post.content}</p>
               <div className="mt-4 flex items-center gap-6 text-sm font-medium text-zinc-500">
                 <span className="flex items-center gap-1"><Heart size={16} /> {post.likes.length}</span>
                 <span className="flex items-center gap-1"><MessageSquare size={16} /> {post.comments.length}</span>
               </div>
             </div>
           ))}
           {tab === 'posts' && myPosts.length === 0 && <p className="text-zinc-500 py-8 text-center">You haven't posted anything yet.</p>}

           {tab === 'comments' && myComments.map(comment => (
             <div key={comment.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-lg">
               <p className="text-sm text-zinc-500 mb-2">Commented on a post: "{comment.post?.content.substring(0, 50)}..."</p>
               <p className="text-zinc-200 font-medium">{comment.content}</p>
             </div>
           ))}
           {tab === 'comments' && myComments.length === 0 && <p className="text-zinc-500 py-8 text-center">You haven't made any comments.</p>}

           {tab === 'likes' && likedPosts.map(post => (
             <div key={post.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-lg">
               <p className="text-sm text-indigo-400 mb-2 font-medium">Post by {post.author.name}</p>
               <p className="text-zinc-200 whitespace-pre-wrap">{post.content}</p>
             </div>
           ))}
           {tab === 'likes' && likedPosts.length === 0 && <p className="text-zinc-500 py-8 text-center">You haven't liked any posts.</p>}

           {tab === 'friends' && (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {friends.map(f => (
                 <div key={f.id} className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col justify-between hover:border-zinc-700 transition-colors">
                    <div>
                      <h3 className="font-bold text-xl mb-1">{f.name}</h3>
                      <p className="text-zinc-400 text-sm mb-4 line-clamp-2">{f.bio}</p>
                    </div>
                    <button onClick={() => onOpenChat(f.id)} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors self-start">
                      Message
                    </button>
                 </div>
               ))}
               {friends.length === 0 && <p className="text-zinc-500 py-8 text-center col-span-full">You haven't subscribed to anyone yet.</p>}
             </div>
           )}
        </div>

      </div>
    </div>
  );
}
