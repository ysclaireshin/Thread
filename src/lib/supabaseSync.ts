import { supabase } from './supabase'

export async function saveProject(project: any) {
  console.log('Saving to Supabase:', project.id, project.nodes.length)
  // Save project
  const { error: projectError } = await supabase
    .from('projects')
    .upsert({
      id: project.id,
      title: project.name,
      thesis: project.thesis,
      updated_at: new Date().toISOString(),
    })

  if (projectError) {
    console.error(projectError)
console.log(projectError.message)
console.log(projectError.details)
console.log(projectError.hint)
console.log(projectError.code)
    return
  }


  // Save nodes
  await supabase
    .from('nodes')
    .delete()
    .eq('project_id', project.id)


  if (project.nodes.length > 0) {
    const { error: nodesError } = await supabase
      .from('nodes')
      .insert(
        project.nodes.map((n: any) => ({
          id: n.id,
          project_id: project.id,
          type: n.organizer,
          organizer: n.organizer,
          label: n.label,
          description: n.description,
          provenance: n.provenance,
          confidence: n.confidence,
          centrality: n.centrality,
          parent_id: n.parent_id,
          current_focus: n.current_focus,
          session_index: n.session_id,
          last_reinforced_at: n.last_reinforced_at,
          resolved: n.resolved ?? false,
        }))
      )

    if (nodesError) {
      console.error('Nodes save failed:', nodesError)
    }
  }
}
