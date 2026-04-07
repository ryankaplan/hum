import {
  Box,
  Button,
  Flex,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, type ReactNode } from "react";
import { useObservable } from "../observable";
import { projectController } from "../state/projectController";
import {
  dsColors,
  dsOutlineButton,
  dsPanel,
  dsPrimaryButton,
} from "./designSystem";

type ProjectShellProps = {
  children: ReactNode;
};

function formatProjectTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ProjectShell({ children }: ProjectShellProps) {
  const projects = useObservable(projectController.projects);
  const currentProjectId = useObservable(projectController.currentProjectId);
  const isReady = useObservable(projectController.isReady);
  const isBusy = useObservable(projectController.isBusy);
  const error = useObservable(projectController.error);

  useEffect(() => {
    void projectController.initialize().catch(() => {});
  }, []);

  function handleRename(projectId: string, currentName: string) {
    const nextName = window.prompt("Rename project", currentName);
    if (nextName == null) return;
    void projectController.renameProject(projectId, nextName).catch(() => {});
  }

  function handleDuplicate(projectId: string) {
    void projectController.duplicateProject(projectId).catch(() => {});
  }

  function handleDelete(projectId: string, projectName: string) {
    const confirmed = window.confirm(`Delete "${projectName}"?`);
    if (!confirmed) return;
    void projectController.deleteProject(projectId).catch(() => {});
  }

  function handleSelectProject(projectId: string) {
    if (projectId === currentProjectId) {
      return;
    }
    void projectController.switchProject(projectId).catch(() => {});
  }

  return (
    <Flex
      minH="100vh"
      bg={dsColors.bg}
      color={dsColors.text}
      direction={{ base: "column", lg: "row" }}
    >
      <Box
        w={{ base: "100%", lg: "320px" }}
        borderRightWidth={{ base: "0", lg: "1px" }}
        borderBottomWidth={{ base: "1px", lg: "0" }}
        borderColor={dsColors.border}
        bg={dsColors.surface}
      >
        <Stack h="100%" p={4} gap={4}>
          <Stack gap={1}>
            <Heading
              size="md"
              fontFamily="'Quicksand', 'Manrope', 'Avenir Next', sans-serif"
            >
              Projects
            </Heading>
            <Text color={dsColors.textMuted} fontSize="sm">
              Each project keeps its own arrangement, recordings, and mix edits.
            </Text>
          </Stack>

          <Button
            {...dsPrimaryButton}
            onClick={() => {
              void projectController.createProject().catch(() => {});
            }}
            disabled={isBusy}
          >
            + New Project
          </Button>

          <Stack gap={2} flex="1" overflow="auto">
            {projects.map((project) => {
              const isActive = project.projectId === currentProjectId;

              return (
                <Box
                  key={project.projectId}
                  borderWidth="1px"
                  borderColor={isActive ? dsColors.accent : dsColors.border}
                  borderRadius="xl"
                  bg={isActive ? dsColors.surfaceRaised : dsColors.surfaceSubtle}
                  p={3}
                  transition="border-color 0.16s ease, background 0.16s ease"
                  {...(isActive ? dsPanel : {})}
                >
                  <Stack gap={3}>
                    <Button
                      variant="ghost"
                      justifyContent="flex-start"
                      alignItems="flex-start"
                      h="auto"
                      px={0}
                      py={0}
                      onClick={() => handleSelectProject(project.projectId)}
                      disabled={isBusy && !isActive}
                      color={dsColors.text}
                    >
                      <Stack align="flex-start" gap={0}>
                        <Text fontWeight="semibold">{project.name}</Text>
                        <Text color={dsColors.textMuted} fontSize="xs">
                          Last opened {formatProjectTimestamp(project.lastOpenedAt)}
                        </Text>
                      </Stack>
                    </Button>

                    <Flex gap={2} wrap="wrap">
                      <Button
                        {...dsOutlineButton}
                        size="xs"
                        onClick={() => handleRename(project.projectId, project.name)}
                        disabled={isBusy}
                      >
                        Rename
                      </Button>
                      <Button
                        {...dsOutlineButton}
                        size="xs"
                        onClick={() => handleDuplicate(project.projectId)}
                        disabled={isBusy}
                      >
                        Duplicate
                      </Button>
                      <Button
                        {...dsOutlineButton}
                        size="xs"
                        borderColor={dsColors.errorBorder}
                        color={dsColors.errorText}
                        onClick={() => handleDelete(project.projectId, project.name)}
                        disabled={isBusy}
                      >
                        Delete
                      </Button>
                    </Flex>
                  </Stack>
                </Box>
              );
            })}
          </Stack>

          {error != null && (
            <Box
              borderWidth="1px"
              borderColor={dsColors.errorBorder}
              bg={dsColors.errorBg}
              color={dsColors.errorText}
              borderRadius="lg"
              p={3}
            >
              <Text fontSize="sm">{error}</Text>
            </Box>
          )}

          <Text color={dsColors.textMuted} fontSize="xs">
            {isBusy ? "Working..." : isReady ? "All changes save automatically." : "Loading projects..."}
          </Text>
        </Stack>
      </Box>

      <Box key={currentProjectId ?? "no-project"} flex="1" minW="0">
        {isReady ? (
          children
        ) : (
          <Flex align="center" justify="center" minH="100vh" px={6}>
            <Text color={dsColors.textMuted}>Loading projects...</Text>
          </Flex>
        )}
      </Box>
    </Flex>
  );
}
