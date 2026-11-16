import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { Activity } from '../../domain/entities/types';
import { activityInputSchema, type ActivityInput } from '../../domain/schemas/records';
import { commit } from '../../services/sync/engine';
import { createActivity, updateActivity } from '../../db/repositories/local';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Input, Label, Textarea } from '../ui/field';
import { ActivityTag } from './ActivityTag';
import { ColorField } from './ColorField';

export function ActivityFormDialog({
  userId,
  open,
  activity,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  activity?: Activity | null;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useForm<ActivityInput>({
    resolver: zodResolver(activityInputSchema),
    defaultValues: { title: '', description: '', color: '#0F766E' },
  });

  useEffect(() => {
    form.reset({
      title: activity?.title ?? '',
      description: activity?.description ?? '',
      color: activity?.color ?? '#0F766E',
    });
  }, [activity, form, open]);

  const color = form.watch('color');
  const title = form.watch('title');

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await commit(async () => {
      if (activity) return updateActivity(userId, activity.id, values);
      return createActivity(userId, values);
    }, userId);
    if (!result.ok) {
      if (result.activity) {
        toast.warning(result.message, { description: `Reutilize “${result.activity.title}”.` });
      } else toast.error(result.message);
      return;
    }
    toast.success(activity ? 'Atividade atualizada.' : 'Atividade criada.');
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{activity ? 'Editar atividade' : 'Nova atividade'}</DialogTitle>
        <DialogDescription>A mesma atividade pode ser agendada várias vezes. Títulos equivalentes não são duplicados.</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="activity-title">Título</Label>
            <Input id="activity-title" {...form.register('title')} />
            {form.formState.errors.title ? <p className="text-sm text-destructive">{form.formState.errors.title.message}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="activity-description">Descrição</Label>
            <Textarea id="activity-description" {...form.register('description')} />
          </div>
          <ColorField color={color || '#0F766E'} preview={title || 'Pré-visualização'} onChange={(value) => form.setValue('color', value, { shouldValidate: true })} />
          {form.formState.errors.color ? <p className="text-sm text-destructive">{form.formState.errors.color.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </div>
          {title ? <ActivityTag title={title} color={color || '#0F766E'} /> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
