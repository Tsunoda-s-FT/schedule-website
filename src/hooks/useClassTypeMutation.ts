import { createClassType } from "@/actions/classType/create";
import { deleteClassType } from "@/actions/classType/delete";
import { updateClassType } from "@/actions/classType/update";
import { useMutation, useQueryClient } from "@tanstack/react-query";


export function useClassTypeCreate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: createClassType,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["classTypes"] });
        }
    });
}

export function useClassTypeUpdate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: updateClassType,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["classTypes"] });
        }
    });
}
export function useClassTypeDelete() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteClassType,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["classTypes"] });
        }
    });
}