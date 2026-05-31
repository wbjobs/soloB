<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => {
    goto('/dashboard');
  });
</script>

<div class="redirecting">
  <div class="spinner"></div>
  <p>正在跳转到仪表盘...</p>
</div>
