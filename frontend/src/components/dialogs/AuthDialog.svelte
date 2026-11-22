<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { login, signup } from '$lib/features/auth/auth';

  let {
    open = $bindable(false),
  }: {
    open: boolean;
  } = $props();

  let mode = $state<'login' | 'signup'>('login');
  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);
  let info = $state<string | null>(null);

  function reset() {
    email = '';
    password = '';
    loading = false;
    error = null;
    info = null;
  }

  function switchMode() {
    mode = mode === 'login' ? 'signup' : 'login';
    error = null;
    info = null;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    loading = true;
    error = null;
    info = null;

    try {
      if (mode === 'login') {
        await login(email.trim(), password);
        open = false;
      } else {
        const result = await signup(email.trim(), password);
        if (result.pendingConfirmation) {
          info = result.message ?? 'Check your email to confirm, then log in.';
          mode = 'login';
          password = '';
        } else {
          open = false;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      loading = false;
    }
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={v => {
    if (!v) reset();
  }}
>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{mode === 'login' ? 'Sign in' : 'Create account'}</Dialog.Title>
    </Dialog.Header>

    {#if error}
      <div class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    {/if}

    {#if info}
      <div class="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
        {info}
      </div>
    {/if}

    <form onsubmit={handleSubmit} class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label for="auth-email">Email</Label>
        <Input
          id="auth-email"
          type="email"
          placeholder="you@example.com"
          bind:value={email}
          disabled={loading}
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="auth-password">Password</Label>
        <Input
          id="auth-password"
          type="password"
          placeholder={mode === 'signup' ? '6+ characters' : ''}
          bind:value={password}
          disabled={loading}
        />
      </div>

      <Button type="submit" disabled={loading || !email.trim() || !password}>
        {#if loading}
          {mode === 'login' ? 'Signing in...' : 'Creating account...'}
        {:else}
          {mode === 'login' ? 'Sign in' : 'Create account'}
        {/if}
      </Button>
    </form>

    <div class="text-center text-sm text-muted-foreground">
      {#if mode === 'login'}
        Don't have an account?
        <button
          type="button"
          class="underline text-foreground hover:text-muted-foreground"
          onclick={switchMode}
        >
          Sign up
        </button>
      {:else}
        Already have an account?
        <button
          type="button"
          class="underline text-foreground hover:text-muted-foreground"
          onclick={switchMode}
        >
          Sign in
        </button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
