"use client"

import { useState, useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { useSubjects } from "@/hooks/useSubjectQuery"
import { useSubjectDelete } from "@/hooks/useSubjectMutation"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Subject } from "@prisma/client"
import { SubjectFormDialog } from "@/components/subject/subject-form-dialog"
import { useSubjectsCount } from "@/hooks/useSubjectQuery"
import { useSubjectTypes } from "@/hooks/useSubjectTypeQuery"

export function SubjectTable() {
    const [searchTerm, setSearchTerm] = useState("")
    const [page, setPage] = useState(1)
    const pageSize = 10
    const { data: subjects = [], isLoading, isFetching } = useSubjects(page, pageSize)
    const { data: totalCount = 0 } = useSubjectsCount()
    const { data: subjectTypes = [] } = useSubjectTypes()
    const deleteSubjectMutation = useSubjectDelete()

    const [subjectToEdit, setSubjectToEdit] = useState<Subject | null>(null)
    const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null)
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

    // Create a mapping from subject type ID to name
    const subjectTypeMap = useMemo(() => {
        const map = new Map<string, string>();
        subjectTypes.forEach(type => {
            map.set(type.subjectTypeId, type.name);
        });
        return map;
    }, [subjectTypes]);

    const filteredSubjects = searchTerm
        ? subjects.filter(
            (subject) =>
                subject.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (subject.notes && subject.notes.toLowerCase().includes(searchTerm.toLowerCase()))
        )
        : subjects

    const columns: ColumnDef<Subject>[] = [
        {
            accessorKey: "name",
            header: "名前",
        },
        {
            accessorKey: "subjectTypeId",
            header: "科目タイプ",
            cell: ({ row }) => {
                const subjectTypeId = row.original.subjectTypeId;
                return subjectTypeId ? subjectTypeMap.get(subjectTypeId) || "-" : "-";
            }
        },
        {
            accessorKey: "notes",
            header: "メモ",
        },
        {
            id: "actions",
            header: "操作",
            cell: ({ row }) => (
                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => setSubjectToEdit(row.original)}>
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setSubjectToDelete(row.original)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                </div>
            ),
        },
    ]

    const handleDeleteSubject = async () => {
        if (subjectToDelete) {
            try {
                await deleteSubjectMutation.mutateAsync(subjectToDelete.subjectId)
                setSubjectToDelete(null)
            } catch (error) {
                console.error("科目の削除に失敗しました:", error)
            }
        }
    }

    const handlePageChange = (newPage: number) => {
        setPage(newPage + 1)
    }

    const totalPages = Math.ceil(totalCount / pageSize)

    return (
        <>
            <DataTable
                columns={columns}
                data={filteredSubjects}
                isLoading={isLoading || isFetching}
                searchPlaceholder="科目を検索..."
                onSearch={setSearchTerm}
                searchValue={searchTerm}
                onCreateNew={() => setIsCreateDialogOpen(true)}
                createNewLabel="新しい科目"
                pageIndex={page - 1}
                pageCount={totalPages || 1}
                onPageChange={handlePageChange}
                pageSize={pageSize}
                totalItems={totalCount}
            />

            {/* Edit Subject Dialog */}
            {subjectToEdit && (
                <SubjectFormDialog
                    open={!!subjectToEdit}
                    onOpenChange={(open) => !open && setSubjectToEdit(null)}
                    subject={subjectToEdit}
                />
            )}

            {/* Create Subject Dialog */}
            <SubjectFormDialog open={isCreateDialogOpen} onOpenChange={(open) => setIsCreateDialogOpen(open)}
                               subject={null}/>

            {/* Delete Subject Confirmation Dialog */}
            <AlertDialog open={!!subjectToDelete} onOpenChange={(open) => !open && setSubjectToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>科目の削除</AlertDialogTitle>
                        <AlertDialogDescription>
                            本当にこの科目を削除しますか？ この操作は元に戻せません。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setSubjectToDelete(null)}>キャンセル</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteSubject}>削除</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
