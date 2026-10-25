<script setup lang="ts">
/** 登录 / 注册：单页双模切换，东方财富式深色渐变头部 */
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import type { Role } from '@/api/types'

const router = useRouter()
const route = useRoute()
const auth = useAuth()

const mode = ref<'login' | 'register'>('login')
const username = ref('retail01')
const password = ref('Stland@2026')
const displayName = ref('')
const role = ref<Role>('retail')
const errorMsg = ref('')
const busy = ref(false)

const roleOptions: Array<{ value: Role; label: string; desc: string }> = [
  { value: 'retail', label: '普通零售', desc: '个人投资者，A 股全品种' },
  { value: 'institution', label: '机构专业', desc: '专业交易台、融资额度' },
]

async function submit() {
  errorMsg.value = ''
  if (mode.value === 'register') {
    if (username.value.trim().length < 3) {
      errorMsg.value = '用户名至少 3 位'
      return
    }
    if (password.value.length < 8) {
      errorMsg.value = '口令至少 8 位'
      return
    }
  }
  busy.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(username.value, password.value)
    } else {
      await auth.register(username.value, password.value, role.value, displayName.value)
    }
    const redirect = (route.query.redirect as string) || '/'
    await router.replace(redirect)
  } catch (e: any) {
    errorMsg.value = e?.message ?? '操作失败'
  } finally {
    busy.value = false
  }
}

function quickFill(name: string, pwd: string) {
  mode.value = 'login'
  username.value = name
  password.value = pwd
  errorMsg.value = ''
}
</script>

<template>
  <div class="login-page">
    <div class="hero">
      <div class="logo">股岛</div>
      <div class="slogan">Stland · 自包含模拟交易所</div>
      <div class="hint">内置 28 支标的 · 真实撮合规则 · 无需外部行情源</div>
    </div>

    <div class="panel keyboard-safe">
      <div class="tabs">
        <button class="tab-btn" :class="{ on: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button class="tab-btn" :class="{ on: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <label class="field">
        <span class="label">账号</span>
        <input v-model="username" class="input" placeholder="输入用户名" autocomplete="username" />
      </label>

      <label class="field">
        <span class="label">口令</span>
        <input v-model="password" class="input" type="password" placeholder="输入登录口令"
          autocomplete="current-password" @keyup.enter="submit" />
      </label>

      <template v-if="mode === 'register'">
        <label class="field">
          <span class="label">昵称</span>
          <input v-model="displayName" class="input" placeholder="展示名称（可选）" />
        </label>
        <div class="field">
          <span class="label">账户类型</span>
          <div class="roles">
            <button v-for="r in roleOptions" :key="r.value" class="role" :class="{ on: role === r.value }"
              @click="role = r.value">
              <div class="role-name">{{ r.label }}</div>
              <div class="role-desc">{{ r.desc }}</div>
            </button>
          </div>
        </div>
      </template>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <button class="btn btn-primary btn-block" :disabled="busy" @click="submit">
        {{ busy ? '处理中…' : mode === 'login' ? '登录' : '注册并开户' }}
      </button>

      <div class="demo">
        <div class="demo-title">演示账户（内置种子数据）</div>
        <div class="demo-list">
          <button class="demo-item" @click="quickFill('retail01', 'Stland@2026')">
            零售 retail01
          </button>
          <button class="demo-item" @click="quickFill('inst01', 'Stland@2026')">
            机构 inst01
          </button>
          <button class="demo-item" @click="quickFill('admin', 'Stland@Admin2026')">
            管理 admin
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  background:
    radial-gradient(120% 60% at 50% 0%, rgba(232, 56, 61, 0.24) 0%, transparent 62%),
    linear-gradient(180deg, #131c28 0%, var(--c-bg) 46%);
  padding-top: var(--status-bar-height);
  display: flex;
  flex-direction: column;
}

.hero {
  padding: 34px 24px 22px;
}
.logo {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 4px;
  background: linear-gradient(120deg, #ff6b6d, #ffb45c);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.slogan {
  margin-top: 6px;
  font-size: 13px;
  color: var(--c-text-2);
}
.hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--c-text-3);
}

.panel {
  flex: 1;
  background: var(--c-bg-elevated);
  border-radius: 22px 22px 0 0;
  padding: 20px 20px calc(24px + var(--safe-bottom));
  border-top: 1px solid var(--c-line);
}

.tabs {
  display: flex;
  gap: 20px;
  margin-bottom: 18px;
}
.tab-btn {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 16px;
  font-weight: 600;
  padding: 4px 0;
  position: relative;
  cursor: pointer;
}
.tab-btn.on {
  color: var(--c-text);
}
.tab-btn.on::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -4px;
  transform: translateX(-50%);
  width: 22px;
  height: 3px;
  border-radius: 2px;
  background: var(--c-brand);
}

.field {
  display: block;
  margin-bottom: 14px;
}
.label {
  display: block;
  font-size: 12px;
  color: var(--c-text-2);
  margin-bottom: 6px;
}

.roles {
  display: flex;
  gap: 10px;
}
.role {
  flex: 1;
  text-align: left;
  background: var(--c-bg);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  color: var(--c-text-2);
  cursor: pointer;
}
.role.on {
  border-color: var(--c-brand);
  background: rgba(232, 56, 61, 0.1);
  color: var(--c-text);
}
.role-name {
  font-size: 13px;
  font-weight: 600;
}
.role-desc {
  font-size: 10px;
  margin-top: 2px;
  color: var(--c-text-3);
}

.error {
  color: #ff7b7d;
  font-size: 12px;
  margin: 4px 0 10px;
}

.demo {
  margin-top: 22px;
  border-top: 1px dashed var(--c-line);
  padding-top: 14px;
}
.demo-title {
  font-size: 11px;
  color: var(--c-text-3);
  margin-bottom: 8px;
}
.demo-list {
  display: flex;
  gap: 8px;
}
.demo-item {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--c-line);
  border-radius: var(--r-sm);
  color: var(--c-text-2);
  font-size: 11px;
  padding: 8px 4px;
  cursor: pointer;
}
</style>
