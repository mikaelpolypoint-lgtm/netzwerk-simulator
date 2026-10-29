<script lang="ts">
  import { dialogs } from '../state/dialogs.svelte';
  import AboutDialog from './AboutDialog.svelte';
  import AdminDialog from './AdminDialog.svelte';
  import CatalogDialog from './CatalogDialog.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import CostDialog from './CostDialog.svelte';
  import FeaturesDialog from './FeaturesDialog.svelte';
  import FeedbackDialog from './FeedbackDialog.svelte';
  import IpCalculator from './IpCalculator.svelte';
  import PrivacyDialog from './PrivacyDialog.svelte';
  import RackDialog from './RackDialog.svelte';
  import ReviewDialog from './ReviewDialog.svelte';
  import SessionDialog from './SessionDialog.svelte';
  import ShortcutsDialog from './ShortcutsDialog.svelte';
  import SnapshotDialog from './SnapshotDialog.svelte';
  import TaskEditor from './TaskEditor.svelte';
  import VlanDialog from './VlanDialog.svelte';

  /** Zeigt den gerade geöffneten Dialog (gesteuert über Menüs, Kürzel und Schaltflächen). */
  const close = () => dialogs.close();
</script>

{#if dialogs.open === 'about'}
  <AboutDialog onclose={close} />
{:else if dialogs.open === 'snapshots'}
  <SnapshotDialog onclose={close} />
{:else if dialogs.open === 'rack'}
  <RackDialog onclose={close} />
{:else if dialogs.open === 'privacy'}
  <PrivacyDialog onclose={close} />
{:else if dialogs.open === 'feedback'}
  <FeedbackDialog onclose={close} />
{:else if dialogs.open === 'admin'}
  <AdminDialog onclose={close} />
{:else if dialogs.open === 'session'}
  <SessionDialog onclose={close} />
{:else if dialogs.open === 'catalog'}
  <CatalogDialog onclose={close} />
{:else if dialogs.open === 'review'}
  <ReviewDialog onclose={close} />
{:else if dialogs.open === 'taskEditor'}
  <TaskEditor onclose={close} />
{:else if dialogs.open === 'features'}
  <FeaturesDialog onclose={close} />
{:else if dialogs.open === 'shortcuts'}
  <ShortcutsDialog onclose={close} />
{:else if dialogs.open === 'palette'}
  <CommandPalette onclose={close} />
{:else if dialogs.open === 'ipcalc'}
  <IpCalculator onclose={close} />
{:else if dialogs.open === 'vlans'}
  <VlanDialog onclose={close} />
{:else if dialogs.open === 'costs'}
  <CostDialog onclose={close} />
{/if}
