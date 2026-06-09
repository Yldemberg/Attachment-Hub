import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  mlItemId?: string | null;
  onConfirm: () => void;
  isPending?: boolean;
};

export function CloseListingDialog({
  open,
  onOpenChange,
  title,
  mlItemId,
  onConfirm,
  isPending,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar anúncio</DialogTitle>
          <DialogDescription>
            O anúncio <strong>{title}</strong>
            {mlItemId ? <> ({mlItemId})</> : null} será encerrado no Mercado Livre. Esta ação não pode ser
            desfeita pelo iHub.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Encerrar anúncio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
