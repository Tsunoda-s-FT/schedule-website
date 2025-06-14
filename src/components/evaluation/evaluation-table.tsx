"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { useEvaluations } from "@/hooks/useEvaluationQuery";
import { useEvaluationDelete, getResolvedEvaluationId } from "@/hooks/useEvaluationMutation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Evaluation } from "@prisma/client";
import { EvaluationFormDialog } from "@/components/evaluation/evaluation-form-dialog";

export function EvaluationTable() {
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const {
    data: evaluations,
    isLoading,
  } = useEvaluations({
    page,
    limit: pageSize,
    name: searchTerm || undefined,
  });
  const totalCount = evaluations?.pagination.total || 0;
  const deleteEvaluationMutation = useEvaluationDelete();

  const [evaluationToEdit, setEvaluationToEdit] = useState<Evaluation | null>(
    null
  );
  const [evaluationToDelete, setEvaluationToDelete] =
    useState<Evaluation | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const columns: ColumnDef<Evaluation>[] = [
    {
      accessorKey: "name",
      header: "名前",
    },
    {
      accessorKey: "score",
      header: "スコア",
    },
    {
      accessorKey: "notes",
      header: "メモ",
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => {
        // Type-safe check for _optimistic property
        const isOptimistic = (row.original as Evaluation & { _optimistic?: boolean })._optimistic;

        return (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEvaluationToEdit(row.original)}
              
            >
              <Pencil className={`h-4 w-4 ${isOptimistic ? 'opacity-70' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEvaluationToDelete(row.original)}
              // disabled={isOptimistic}
            >
              <Trash2 className={`h-4 w-4 text-destructive ${isOptimistic ? 'opacity-70' : ''}`} />
            </Button>
          </div>
        );
      },
    },
  ];

  const handleDeleteEvaluation = () => {
    if (evaluationToDelete) {
      // Close the dialog immediately for better UX
      // Use getResolvedEvaluationId to resolve temp/server IDs
      const evaluationId = getResolvedEvaluationId(evaluationToDelete.evaluationId);
      setEvaluationToDelete(null);
      deleteEvaluationMutation.mutate(evaluationId);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage + 1);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      <DataTable
        columns={columns}
        data={evaluations?.data || []}
        isLoading={isLoading && !evaluations} // Only show loading state on initial load
        searchPlaceholder="評価を検索..."
        onSearch={setSearchTerm}
        searchValue={searchTerm}
        onCreateNew={() => setIsCreateDialogOpen(true)}
        createNewLabel="新しい評価"
        pageIndex={page - 1}
        pageCount={totalPages || 1}
        onPageChange={handlePageChange}
        pageSize={pageSize}
        totalItems={totalCount}
      />

      {/* Edit Evaluation Dialog */}
      {evaluationToEdit && (
        <EvaluationFormDialog
          open={!!evaluationToEdit}
          onOpenChange={(open) => !open && setEvaluationToEdit(null)}
          evaluation={evaluationToEdit}
        />
      )}

      {/* Create Evaluation Dialog */}
      <EvaluationFormDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!evaluationToDelete}
        onOpenChange={(open) => !open && setEvaluationToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>本当に削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この操作は元に戻せません。評価「{evaluationToDelete?.name}
              」を永久に削除します。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteEvaluation}
              disabled={deleteEvaluationMutation.isPending}
            >
              {deleteEvaluationMutation.isPending ? "削除中..." : "削除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
